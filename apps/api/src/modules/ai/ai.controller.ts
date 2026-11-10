import {
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import { PROMPTS } from '@devpulse/ai';
import { requestAnalysisSchema } from '@devpulse/shared';
import {
  type AuthUser,
  CurrentUser,
  Membership,
  type OrgMembership,
  RequirePermission,
} from '../../common/context.js';
import { ZodBody } from '../../common/zod.js';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';
import { QueueService } from '../../queue/queue.service.js';

const PROMPT_VERSIONS = {
  INCIDENT: PROMPTS.incidentAnalysis.version,
  ERROR_GROUP: PROMPTS.errorGroupAnalysis.version,
} as const;

export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

@ApiTags('ai')
@Controller('orgs/:orgId/ai')
export class AiController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly queues: QueueService,
  ) {}

  @Get('status')
  @RequirePermission('org:read')
  async status(@Membership() m: OrgMembership) {
    const [org, spent] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: m.organizationId },
        select: { aiMonthlyBudgetUsd: true },
      }),
      this.spentThisMonth(m.organizationId),
    ]);
    return {
      configured: Boolean(this.env.ANTHROPIC_API_KEY),
      provider: 'anthropic',
      monthlyBudgetUsd: Number(org.aiMonthlyBudgetUsd),
      spentThisMonthUsd: spent,
    };
  }

  /**
   * Requests an analysis. It runs asynchronously in the worker; the client polls the
   * returned record. Without an API key the record is stored as NOT_CONFIGURED and no
   * analysis is attempted — the UI shows that configuration is pending.
   */
  @Post('analyses')
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('ai:analyze')
  async request(
    @Membership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @ZodBody(requestAnalysisSchema) body: z.output<typeof requestAnalysisSchema>,
  ) {
    const target =
      body.targetType === 'INCIDENT'
        ? await this.prisma.incident.findFirst({
            where: { id: body.targetId, organizationId: m.organizationId },
            select: { id: true },
          })
        : await this.prisma.errorGroup.findFirst({
            where: { id: body.targetId, organizationId: m.organizationId },
            select: { id: true },
          });
    if (!target)
      throw new NotFoundException(
        `${body.targetType === 'INCIDENT' ? 'Incident' : 'Error group'} not found`,
      );

    const base = {
      organizationId: m.organizationId,
      targetType: body.targetType,
      incidentId: body.targetType === 'INCIDENT' ? target.id : null,
      errorGroupId: body.targetType === 'ERROR_GROUP' ? target.id : null,
      promptVersion: PROMPT_VERSIONS[body.targetType],
      requestedById: user.id,
    };

    if (!this.env.ANTHROPIC_API_KEY) {
      return this.prisma.aIAnalysis.create({
        data: {
          ...base,
          status: 'NOT_CONFIGURED',
          errorMessage:
            'AI analysis is not configured: set ANTHROPIC_API_KEY on the API and worker.',
          completedAt: new Date(),
        },
      });
    }

    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: m.organizationId },
      select: { aiMonthlyBudgetUsd: true },
    });
    if ((await this.spentThisMonth(m.organizationId)) >= Number(org.aiMonthlyBudgetUsd)) {
      return this.prisma.aIAnalysis.create({
        data: {
          ...base,
          status: 'BUDGET_EXCEEDED',
          errorMessage: 'Monthly AI budget reached. An admin can raise it in Settings.',
          completedAt: new Date(),
        },
      });
    }

    // At most one analysis in flight per target: return it instead of paying twice.
    const inFlight = await this.prisma.aIAnalysis.findFirst({
      where: {
        organizationId: m.organizationId,
        incidentId: base.incidentId,
        errorGroupId: base.errorGroupId,
        status: { in: ['PENDING', 'RUNNING'] },
      },
    });
    if (inFlight) return inFlight;

    const analysis = await this.prisma.aIAnalysis.create({ data: { ...base, status: 'PENDING' } });
    await this.queues.aiAnalysis.add(
      'analyze',
      { analysisId: analysis.id },
      { jobId: `analysis-${analysis.id}` },
    );
    return analysis;
  }

  @Get('analyses')
  @RequirePermission('org:read')
  list(@Membership() m: OrgMembership) {
    return this.prisma.aIAnalysis.findMany({
      where: { organizationId: m.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        incident: { select: { id: true, title: true } },
        errorGroup: { select: { id: true, title: true } },
        requestedBy: { select: { id: true, name: true } },
      },
    });
  }

  @Get('analyses/:analysisId')
  @RequirePermission('org:read')
  async get(@Membership() m: OrgMembership, @Param('analysisId', ParseUUIDPipe) id: string) {
    const analysis = await this.prisma.aIAnalysis.findFirst({
      where: { id, organizationId: m.organizationId },
      include: {
        incident: { select: { id: true, title: true } },
        errorGroup: { select: { id: true, title: true } },
        usageRecords: {
          select: { inputTokens: true, outputTokens: true, costUsd: true, model: true },
        },
      },
    });
    if (!analysis) throw new NotFoundException('Analysis not found');
    return analysis;
  }

  @Get('usage')
  @RequirePermission('org:read')
  async usage(@Membership() m: OrgMembership) {
    const rows = await this.prisma.$queryRaw<
      { day: Date; model: string; input: number; output: number; cost: string; calls: number }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day, "model", SUM("inputTokens")::int AS input, SUM("outputTokens")::int AS output,
             SUM("costUsd")::text AS cost, COUNT(*)::int AS calls
      FROM "UsageRecord" WHERE "organizationId" = ${m.organizationId}::uuid AND "createdAt" >= ${monthStart()}
      GROUP BY 1, 2 ORDER BY 1 DESC`;
    return rows.map((r) => ({ ...r, cost: Number(r.cost) }));
  }

  private async spentThisMonth(organizationId: string) {
    const agg = await this.prisma.usageRecord.aggregate({
      where: { organizationId, createdAt: { gte: monthStart() } },
      _sum: { costUsd: true },
    });
    return Number(agg._sum.costUsd ?? 0);
  }
}
