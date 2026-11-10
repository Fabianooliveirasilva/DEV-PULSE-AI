import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  createApplicationSchema,
  createProjectSchema,
  rangeQuerySchema,
  updateApplicationSchema,
  updateProjectSchema,
  uptimeFromCounts,
} from '@devpulse/shared';
import { Membership, type OrgMembership, RequirePermission } from '../../common/context.js';
import { ZodBody, ZodQuery } from '../../common/zod.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';
import { TIME_RANGE_MS } from '@devpulse/shared';
import { MonitorSchedulerService } from '../monitors/monitor-scheduler.service.js';

@ApiTags('projects & applications')
@Controller('orgs/:orgId')
export class ApplicationsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly scheduler: MonitorSchedulerService,
  ) {}

  // ───────── projects ─────────

  @Get('projects')
  @RequirePermission('org:read')
  projects(@Membership() m: OrgMembership) {
    return this.prisma.project.findMany({
      where: { organizationId: m.organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        _count: { select: { applications: true } },
      },
    });
  }

  @Post('projects')
  @RequirePermission('apps:write')
  createProject(
    @Membership() m: OrgMembership,
    @ZodBody(createProjectSchema) body: z.output<typeof createProjectSchema>,
  ) {
    return this.prisma.project.create({ data: { ...body, organizationId: m.organizationId } });
  }

  @Patch('projects/:projectId')
  @RequirePermission('apps:write')
  async updateProject(
    @Membership() m: OrgMembership,
    @Param('projectId', ParseUUIDPipe) id: string,
    @ZodBody(updateProjectSchema) body: z.output<typeof updateProjectSchema>,
  ) {
    await this.assertProject(m.organizationId, id);
    return this.prisma.project.update({ where: { id }, data: body });
  }

  /** Restricted: a project with applications cannot be deleted (FK onDelete: Restrict). */
  @Delete('projects/:projectId')
  @HttpCode(204)
  @RequirePermission('apps:write')
  async deleteProject(
    @Membership() m: OrgMembership,
    @Param('projectId', ParseUUIDPipe) id: string,
  ) {
    await this.assertProject(m.organizationId, id);
    await this.prisma.project.delete({ where: { id } });
  }

  // ───────── applications ─────────

  @Get('applications')
  @RequirePermission('org:read')
  async applications(@Membership() m: OrgMembership) {
    const apps = await this.prisma.application.findMany({
      where: { organizationId: m.organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        environment: true,
        createdAt: true,
        project: { select: { id: true, name: true } },
        monitors: {
          select: {
            id: true,
            status: true,
            lastLatencyMs: true,
            lastCheckedAt: true,
            isActive: true,
          },
        },
        _count: { select: { incidents: { where: { status: { not: 'RESOLVED' } } } } },
      },
    });
    return apps.map(({ monitors, _count, ...app }) => ({
      ...app,
      status: aggregateStatus(monitors.map((mo) => mo.status)),
      monitorCount: monitors.length,
      openIncidents: _count.incidents,
      lastCheckedAt: monitors.reduce<Date | null>(
        (acc, mo) =>
          mo.lastCheckedAt && (!acc || mo.lastCheckedAt > acc) ? mo.lastCheckedAt : acc,
        null,
      ),
    }));
  }

  @Post('applications')
  @RequirePermission('apps:write')
  async createApplication(
    @Membership() m: OrgMembership,
    @ZodBody(createApplicationSchema) body: z.output<typeof createApplicationSchema>,
  ) {
    await this.assertProject(m.organizationId, body.projectId);
    return this.prisma.application.create({ data: { ...body, organizationId: m.organizationId } });
  }

  @Get('applications/:appId')
  @RequirePermission('org:read')
  async application(
    @Membership() m: OrgMembership,
    @Param('appId', ParseUUIDPipe) id: string,
    @ZodQuery(rangeQuerySchema) query: z.output<typeof rangeQuerySchema>,
  ) {
    const app = await this.prisma.application.findFirst({
      where: { id, organizationId: m.organizationId },
      include: {
        project: { select: { id: true, name: true } },
        monitors: { orderBy: { createdAt: 'asc' } },
        incidents: {
          orderBy: { openedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            title: true,
            severity: true,
            status: true,
            openedAt: true,
            resolvedAt: true,
          },
        },
      },
    });
    if (!app) throw new NotFoundException('Application not found');
    const since = new Date(Date.now() - TIME_RANGE_MS[query.range]);
    const counts = await this.prisma.monitorCheck.groupBy({
      by: ['result'],
      where: {
        organizationId: m.organizationId,
        monitor: { applicationId: id },
        checkedAt: { gte: since },
      },
      _count: { _all: true },
    });
    const total = counts.reduce((acc, c) => acc + c._count._all, 0);
    const down = counts.find((c) => c.result === 'DOWN')?._count._all ?? 0;
    return {
      ...app,
      status: aggregateStatus(app.monitors.map((mo) => mo.status)),
      uptime: uptimeFromCounts(total, down),
      checkCount: total,
    };
  }

  @Patch('applications/:appId')
  @RequirePermission('apps:write')
  async updateApplication(
    @Membership() m: OrgMembership,
    @Param('appId', ParseUUIDPipe) id: string,
    @ZodBody(updateApplicationSchema) body: z.output<typeof updateApplicationSchema>,
  ) {
    await this.assertApplication(m.organizationId, id);
    return this.prisma.application.update({ where: { id }, data: body });
  }

  @Delete('applications/:appId')
  @HttpCode(204)
  @RequirePermission('apps:write')
  async deleteApplication(
    @Membership() m: OrgMembership,
    @Param('appId', ParseUUIDPipe) id: string,
  ) {
    await this.assertApplication(m.organizationId, id);
    const monitors = await this.prisma.monitor.findMany({
      where: { applicationId: id },
      select: { id: true },
    });
    await this.prisma.application.delete({ where: { id } });
    await Promise.all(monitors.map((mo) => this.scheduler.unschedule(mo.id)));
  }

  private async assertProject(organizationId: string, id: string) {
    if (
      !(await this.prisma.project.findFirst({
        where: { id, organizationId },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('Project not found');
    }
  }

  private async assertApplication(organizationId: string, id: string) {
    if (
      !(await this.prisma.application.findFirst({
        where: { id, organizationId },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('Application not found');
    }
  }
}

/** The worst status among active monitors defines the application's status. */
export function aggregateStatus(
  statuses: string[],
): 'UP' | 'DEGRADED' | 'DOWN' | 'PENDING' | 'NO_MONITORS' {
  const active = statuses.filter((s) => s !== 'PAUSED');
  if (active.length === 0) return 'NO_MONITORS';
  if (active.includes('DOWN')) return 'DOWN';
  if (active.includes('DEGRADED')) return 'DEGRADED';
  if (active.every((s) => s === 'PENDING')) return 'PENDING';
  return 'UP';
}
