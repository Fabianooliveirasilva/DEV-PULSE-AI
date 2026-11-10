import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { notifyOrganization, type Prisma } from '@devpulse/database';
import {
  allowedTransitions,
  canTransition,
  createIncidentSchema,
  incidentCommentSchema,
  incidentQuerySchema,
  type IncidentStatus,
  updateIncidentSchema,
} from '@devpulse/shared';
import {
  type AuthUser,
  CurrentUser,
  Membership,
  type OrgMembership,
  paginate,
  RequirePermission,
} from '../../common/context.js';
import { ZodBody, ZodQuery } from '../../common/zod.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service.js';

const listSelect = {
  id: true,
  title: true,
  severity: true,
  status: true,
  source: true,
  openedAt: true,
  resolvedAt: true,
  application: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
} as const;

@ApiTags('incidents')
@Controller('orgs/:orgId/incidents')
export class IncidentsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  @Get()
  @RequirePermission('org:read')
  async list(
    @Membership() m: OrgMembership,
    @ZodQuery(incidentQuerySchema) q: z.output<typeof incidentQuerySchema>,
  ) {
    const where: Prisma.IncidentWhereInput = {
      organizationId: m.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.active === true ? { status: { not: 'RESOLVED' } } : {}),
      ...(q.active === false ? { status: 'RESOLVED' } : {}),
      ...(q.applicationId ? { applicationId: q.applicationId } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
    };
    const rows = await this.prisma.incident.findMany({
      where,
      orderBy: { id: 'desc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: listSelect,
    });
    return paginate(rows, q.limit);
  }

  @Post()
  @RequirePermission('incidents:write')
  async create(
    @Membership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @ZodBody(createIncidentSchema) body: z.output<typeof createIncidentSchema>,
  ) {
    const app = await this.prisma.application.findFirst({
      where: { id: body.applicationId, organizationId: m.organizationId },
    });
    if (!app) throw new NotFoundException('Application not found');
    const { incident, channels } = await this.prisma.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          organizationId: m.organizationId,
          applicationId: app.id,
          title: body.title,
          severity: body.severity,
          source: 'MANUAL',
          probableCause: body.probableCause ?? null,
        },
        select: listSelect,
      });
      await tx.incidentEvent.create({
        data: {
          organizationId: m.organizationId,
          incidentId: incident.id,
          type: 'CREATED',
          actorId: user.id,
          message: `Incident declared by ${user.name}`,
          toStatus: 'OPEN',
        },
      });
      const channels =
        body.severity === 'CRITICAL'
          ? await notifyOrganization(tx, {
              organizationId: m.organizationId,
              type: 'INCIDENT_CRITICAL',
              title: `Critical incident: ${body.title}`,
              body: `${user.name} declared a critical incident on ${app.name}.`,
              incidentId: incident.id,
              applicationId: app.id,
            })
          : [];
      return { incident, channels };
    });
    await this.dispatch.enqueue(channels, {
      organizationId: m.organizationId,
      type: 'INCIDENT_CRITICAL',
      title: `Critical incident: ${body.title}`,
      body: `Declared on ${app.name}`,
      incidentId: incident.id,
    });
    return incident;
  }

  @Get(':incidentId')
  @RequirePermission('org:read')
  async get(@Membership() m: OrgMembership, @Param('incidentId', ParseUUIDPipe) id: string) {
    const incident = await this.prisma.incident.findFirst({
      where: { id, organizationId: m.organizationId },
      include: {
        application: { select: { id: true, name: true, environment: true } },
        monitor: { select: { id: true, name: true, url: true, method: true } },
        assignee: { select: { id: true, name: true, email: true } },
        events: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { id: true, name: true } } },
        },
        checks: { orderBy: { checkedAt: 'desc' }, take: 50 },
        aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!incident) throw new NotFoundException('Incident not found');
    return {
      ...incident,
      allowedTransitions: allowedTransitions(incident.status as IncidentStatus),
    };
  }

  @Patch(':incidentId')
  @RequirePermission('incidents:write')
  async update(
    @Membership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('incidentId', ParseUUIDPipe) id: string,
    @ZodBody(updateIncidentSchema) body: z.output<typeof updateIncidentSchema>,
  ) {
    const current = await this.prisma.incident.findFirst({
      where: { id, organizationId: m.organizationId },
    });
    if (!current) throw new NotFoundException('Incident not found');

    const events: Prisma.IncidentEventCreateManyInput[] = [];
    const data: Prisma.IncidentUncheckedUpdateInput = {};
    const base = { organizationId: m.organizationId, incidentId: id, actorId: user.id };

    if (body.status && body.status !== current.status) {
      if (!canTransition(current.status as IncidentStatus, body.status)) {
        throw new BadRequestException(
          `Cannot move an incident from ${current.status} to ${body.status}`,
        );
      }
      data.status = body.status;
      if (body.status === 'RESOLVED') {
        data.resolvedAt = new Date();
        data.activeMonitorId = null; // frees the slot so a future outage opens a new incident
      }
      if (current.status === 'RESOLVED') {
        if (current.monitorId) {
          const active = await this.prisma.incident.findUnique({
            where: { activeMonitorId: current.monitorId },
            select: { id: true },
          });
          if (active)
            throw new BadRequestException('Another incident is already open for this monitor');
          data.activeMonitorId = current.monitorId;
        }
        data.resolvedAt = null;
      }
      events.push({
        ...base,
        type: 'STATUS_CHANGED',
        message: `Status changed from ${current.status} to ${body.status}`,
        fromStatus: current.status,
        toStatus: body.status,
      });
    }
    if (body.severity && body.severity !== current.severity) {
      data.severity = body.severity;
      events.push({
        ...base,
        type: 'SEVERITY_CHANGED',
        message: `Severity changed from ${current.severity} to ${body.severity}`,
      });
    }
    if (body.assigneeId !== undefined && body.assigneeId !== current.assigneeId) {
      if (body.assigneeId) {
        const member = await this.prisma.organizationMember.findUnique({
          where: {
            organizationId_userId: { organizationId: m.organizationId, userId: body.assigneeId },
          },
          include: { user: { select: { name: true } } },
        });
        if (!member)
          throw new BadRequestException('Assignee must be a member of this organization');
        events.push({ ...base, type: 'ASSIGNED', message: `Assigned to ${member.user.name}` });
      } else {
        events.push({ ...base, type: 'ASSIGNED', message: 'Unassigned' });
      }
      data.assigneeId = body.assigneeId;
    }
    if (body.probableCause !== undefined && body.probableCause !== current.probableCause) {
      data.probableCause = body.probableCause;
      events.push({
        ...base,
        type: 'CAUSE_UPDATED',
        message: body.probableCause
          ? `Probable cause: ${body.probableCause}`
          : 'Probable cause cleared',
      });
    }
    if (body.resolutionNote !== undefined) data.resolutionNote = body.resolutionNote;

    await this.prisma.$transaction([
      this.prisma.incident.update({ where: { id }, data }),
      this.prisma.incidentEvent.createMany({ data: events }),
    ]);
    return this.get(m, id);
  }

  @Post(':incidentId/comments')
  @RequirePermission('incidents:write')
  async comment(
    @Membership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('incidentId', ParseUUIDPipe) id: string,
    @ZodBody(incidentCommentSchema) body: z.output<typeof incidentCommentSchema>,
  ) {
    const incident = await this.prisma.incident.findFirst({
      where: { id, organizationId: m.organizationId },
      select: { id: true },
    });
    if (!incident) throw new NotFoundException('Incident not found');
    return this.prisma.incidentEvent.create({
      data: {
        organizationId: m.organizationId,
        incidentId: id,
        type: 'COMMENT',
        actorId: user.id,
        message: body.message,
      },
      include: { actor: { select: { id: true, name: true } } },
    });
  }

  /** Post-incident report assembled from stored facts only (no AI unless an analysis exists). */
  @Get(':incidentId/report')
  @RequirePermission('org:read')
  async report(@Membership() m: OrgMembership, @Param('incidentId', ParseUUIDPipe) id: string) {
    const incident = await this.get(m, id);
    const failedChecks = incident.checks.filter((c) => c.result === 'DOWN');
    const durationMs = (incident.resolvedAt ?? new Date()).getTime() - incident.openedAt.getTime();
    const latestAnalysis = incident.aiAnalyses.find((a) => a.status === 'COMPLETED') ?? null;
    return {
      id: incident.id,
      title: incident.title,
      application: incident.application,
      severity: incident.severity,
      status: incident.status,
      openedAt: incident.openedAt,
      resolvedAt: incident.resolvedAt,
      durationMs,
      probableCause: incident.probableCause,
      resolutionNote: incident.resolutionNote,
      impact: {
        failedChecks: failedChecks.length,
        errorTypes: [...new Set(failedChecks.map((c) => c.errorType).filter(Boolean))],
      },
      timeline: incident.events.map((e) => ({
        at: e.createdAt,
        type: e.type,
        message: e.message,
        actor: e.actor?.name ?? 'system',
      })),
      aiAnalysis: latestAnalysis
        ? {
            id: latestAnalysis.id,
            summary: latestAnalysis.summary,
            promptVersion: latestAnalysis.promptVersion,
            model: latestAnalysis.model,
            createdAt: latestAnalysis.createdAt,
          }
        : null,
    };
  }
}
