import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import type { Prisma } from '@devpulse/database';
import {
  createApiKeySchema,
  ingestBatchSchema,
  logQuerySchema,
  rangeQuerySchema,
  TIME_RANGE_MS,
} from '@devpulse/shared';
import { generateApiKey } from '@devpulse/shared/node';
import type { Request } from 'express';
import {
  type AuthUser,
  clientIp,
  CurrentUser,
  Ingest,
  type IngestPrincipal,
  Membership,
  type OrgMembership,
  paginate,
  Public,
  RequirePermission,
} from '../../common/context.js';
import { ZodBody, ZodQuery } from '../../common/zod.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { likeEscape, LogsService } from './logs.service.js';

@ApiTags('logs')
@Controller()
export class LogsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly logs: LogsService,
    private readonly audit: AuditService,
  ) {}

  /** Public ingestion endpoint, authenticated by an application API key. */
  @Public()
  @UseGuards(ApiKeyGuard)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiHeader({
    name: 'X-DevPulse-Key',
    description: 'Application ingestion key (or Authorization: Bearer <key>)',
  })
  @HttpCode(202)
  @Post('ingest/logs')
  ingest(
    @Ingest() principal: IngestPrincipal,
    @ZodBody(ingestBatchSchema) body: z.output<typeof ingestBatchSchema>,
  ) {
    return this.logs.ingest(principal, body.logs);
  }

  @Get('orgs/:orgId/logs')
  @RequirePermission('logs:read')
  async search(
    @Membership() m: OrgMembership,
    @ZodQuery(logQuerySchema) q: z.output<typeof logQuerySchema>,
  ) {
    const where: Prisma.LogWhereInput = {
      organizationId: m.organizationId,
      ...(q.applicationId ? { applicationId: q.applicationId } : {}),
      ...(q.errorGroupId ? { errorGroupId: q.errorGroupId } : {}),
      ...(q.severity ? { severity: { in: q.severity } } : {}),
      ...(q.environment ? { environment: q.environment.toLowerCase() } : {}),
      ...(q.q ? { message: { contains: likeEscape(q.q), mode: 'insensitive' } } : {}),
      ...(q.from || q.to
        ? {
            timestamp: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.log.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        timestamp: true,
        severity: true,
        environment: true,
        message: true,
        metadata: true,
        errorGroupId: true,
        application: { select: { id: true, name: true } },
      },
    });
    return paginate(rows, q.limit);
  }

  @Get('orgs/:orgId/error-groups')
  @RequirePermission('logs:read')
  errorGroups(
    @Membership() m: OrgMembership,
    @ZodQuery(rangeQuerySchema) q: z.output<typeof rangeQuerySchema>,
  ) {
    return this.prisma.errorGroup.findMany({
      where: {
        organizationId: m.organizationId,
        lastSeenAt: { gte: new Date(Date.now() - TIME_RANGE_MS[q.range]) },
        ...(q.applicationId ? { applicationId: q.applicationId } : {}),
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
      include: { application: { select: { id: true, name: true } } },
    });
  }

  @Get('orgs/:orgId/error-groups/:groupId')
  @RequirePermission('logs:read')
  async errorGroup(@Membership() m: OrgMembership, @Param('groupId', ParseUUIDPipe) id: string) {
    const group = await this.prisma.errorGroup.findFirst({
      where: { id, organizationId: m.organizationId },
      include: {
        application: { select: { id: true, name: true, environment: true } },
        logs: {
          orderBy: { timestamp: 'desc' },
          take: 20,
          select: {
            id: true,
            timestamp: true,
            severity: true,
            environment: true,
            message: true,
            metadata: true,
          },
        },
        aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!group) throw new NotFoundException('Error group not found');
    const hourly = await this.prisma.$queryRaw<{ hour: Date; count: number }[]>`
      SELECT date_trunc('hour', "timestamp") AS hour, COUNT(*)::int AS count
      FROM "Log" WHERE "errorGroupId" = ${id}::uuid AND "timestamp" > now() - interval '48 hours'
      GROUP BY 1 ORDER BY 1 DESC`;
    return { ...group, hourly };
  }

  // ───────── API keys ─────────

  @Get('orgs/:orgId/applications/:appId/api-keys')
  @RequirePermission('org:read')
  async apiKeys(@Membership() m: OrgMembership, @Param('appId', ParseUUIDPipe) appId: string) {
    await this.assertApp(m.organizationId, appId);
    return this.prisma.apiKey.findMany({
      where: { applicationId: appId, organizationId: m.organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    });
  }

  /** The plain key is returned exactly once; only its SHA-256 is stored. */
  @Post('orgs/:orgId/applications/:appId/api-keys')
  @RequirePermission('apikeys:manage')
  async createApiKey(
    @Membership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('appId', ParseUUIDPipe) appId: string,
    @ZodBody(createApiKeySchema) body: z.output<typeof createApiKeySchema>,
    @Req() req: Request,
  ) {
    await this.assertApp(m.organizationId, appId);
    const { key, prefix, hash } = generateApiKey();
    const record = await this.prisma.apiKey.create({
      data: {
        organizationId: m.organizationId,
        applicationId: appId,
        name: body.name,
        prefix,
        keyHash: hash,
        createdById: user.id,
      },
      select: { id: true, name: true, prefix: true, createdAt: true },
    });
    await this.audit.record({
      action: 'apikey.created',
      organizationId: m.organizationId,
      actorId: user.id,
      targetType: 'apiKey',
      targetId: record.id,
      ipAddress: clientIp(req),
    });
    return { ...record, key };
  }

  @Delete('orgs/:orgId/applications/:appId/api-keys/:keyId')
  @HttpCode(204)
  @RequirePermission('apikeys:manage')
  async revokeApiKey(
    @Membership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
    @Req() req: Request,
  ) {
    const { count } = await this.prisma.apiKey.updateMany({
      where: { id: keyId, applicationId: appId, organizationId: m.organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('API key not found');
    await this.audit.record({
      action: 'apikey.revoked',
      organizationId: m.organizationId,
      actorId: user.id,
      targetType: 'apiKey',
      targetId: keyId,
      ipAddress: clientIp(req),
    });
  }

  private async assertApp(organizationId: string, id: string) {
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
