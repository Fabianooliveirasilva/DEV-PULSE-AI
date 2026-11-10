import {
  BadRequestException,
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
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import { checkQuerySchema, createMonitorSchema, updateMonitorSchema } from '@devpulse/shared';
import { BlockedDestinationError, validateDestination } from '@devpulse/shared/node';
import {
  Membership,
  type OrgMembership,
  paginate,
  RequirePermission,
} from '../../common/context.js';
import { ZodBody, ZodQuery } from '../../common/zod.js';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';
import { MonitorSchedulerService } from './monitor-scheduler.service.js';

@ApiTags('monitors')
@Controller('orgs/:orgId/monitors')
export class MonitorsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly scheduler: MonitorSchedulerService,
  ) {}

  @Get()
  @RequirePermission('org:read')
  list(@Membership() m: OrgMembership) {
    return this.prisma.monitor.findMany({
      where: { organizationId: m.organizationId },
      orderBy: { createdAt: 'asc' },
      include: { application: { select: { id: true, name: true, environment: true } } },
    });
  }

  @Post()
  @RequirePermission('monitors:write')
  async create(
    @Membership() m: OrgMembership,
    @ZodBody(createMonitorSchema) body: z.output<typeof createMonitorSchema>,
  ) {
    const app = await this.prisma.application.findFirst({
      where: { id: body.applicationId, organizationId: m.organizationId },
    });
    if (!app) throw new NotFoundException('Application not found');
    await this.assertSafeUrl(body.url);
    const monitor = await this.prisma.monitor.create({
      data: {
        ...body,
        latencyThresholdMs: body.latencyThresholdMs ?? null,
        organizationId: m.organizationId,
        status: body.isActive ? 'PENDING' : 'PAUSED',
      },
    });
    await this.scheduler.schedule(monitor);
    if (monitor.isActive) await this.scheduler.runNow(monitor.id);
    return monitor;
  }

  @Get(':monitorId')
  @RequirePermission('org:read')
  async get(@Membership() m: OrgMembership, @Param('monitorId', ParseUUIDPipe) id: string) {
    const monitor = await this.prisma.monitor.findFirst({
      where: { id, organizationId: m.organizationId },
      include: { application: { select: { id: true, name: true, environment: true } } },
    });
    if (!monitor) throw new NotFoundException('Monitor not found');
    return monitor;
  }

  @Patch(':monitorId')
  @RequirePermission('monitors:write')
  async update(
    @Membership() m: OrgMembership,
    @Param('monitorId', ParseUUIDPipe) id: string,
    @ZodBody(updateMonitorSchema) body: z.output<typeof updateMonitorSchema>,
  ) {
    const current = await this.get(m, id);
    if (body.url) await this.assertSafeUrl(body.url);
    const interval = body.intervalSeconds ?? current.intervalSeconds;
    const timeout = body.timeoutMs ?? current.timeoutMs;
    if (timeout >= interval * 1000)
      throw new BadRequestException('Timeout must be shorter than the interval');
    const pausing = body.isActive === false;
    const resuming = body.isActive === true && !current.isActive;
    const monitor = await this.prisma.monitor.update({
      where: { id },
      data: {
        ...body,
        ...(pausing ? { status: 'PAUSED' } : {}),
        ...(resuming ? { status: 'PENDING', consecutiveFailures: 0 } : {}),
      },
    });
    await this.scheduler.schedule(monitor);
    return monitor;
  }

  @Delete(':monitorId')
  @HttpCode(204)
  @RequirePermission('monitors:write')
  async remove(@Membership() m: OrgMembership, @Param('monitorId', ParseUUIDPipe) id: string) {
    await this.get(m, id);
    await this.prisma.monitor.delete({ where: { id } });
    await this.scheduler.unschedule(id);
  }

  @Post(':monitorId/run')
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('monitors:write')
  async runNow(@Membership() m: OrgMembership, @Param('monitorId', ParseUUIDPipe) id: string) {
    const monitor = await this.get(m, id);
    if (!monitor.isActive)
      throw new BadRequestException('Resume the monitor before running a check');
    await this.scheduler.runNow(id);
    return { queued: true };
  }

  @Get(':monitorId/checks')
  @RequirePermission('org:read')
  async checks(
    @Membership() m: OrgMembership,
    @Param('monitorId', ParseUUIDPipe) id: string,
    @ZodQuery(checkQuerySchema) query: z.output<typeof checkQuerySchema>,
  ) {
    await this.get(m, id);
    const rows = await this.prisma.monitorCheck.findMany({
      where: { monitorId: id, organizationId: m.organizationId },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        result: true,
        statusCode: true,
        latencyMs: true,
        errorType: true,
        errorMessage: true,
        checkedAt: true,
        incidentId: true,
      },
    });
    return paginate(rows, query.limit);
  }

  private async assertSafeUrl(url: string) {
    try {
      await validateDestination(url, { allowlist: this.env.SSRF_ALLOWLIST });
    } catch (error) {
      if (error instanceof BlockedDestinationError)
        throw new BadRequestException(`URL not allowed: ${error.message}`);
      throw new BadRequestException('The URL host could not be resolved');
    }
  }
}
