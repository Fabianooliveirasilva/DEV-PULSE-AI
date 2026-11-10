import {
  AIProviderError,
  type AnalysisTarget,
  costUsd,
  type ContextLog,
  runAnalysis,
  type TokenUsage,
} from '@devpulse/ai';
import type { Prisma } from '@devpulse/database';
import type { WorkerDeps } from '../deps.js';

const LOG_WINDOW_MS = 60 * 60_000;

export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface AnalysisJobContext {
  analysisId: string;
  /** True when BullMQ will not retry again after this attempt. */
  finalAttempt: boolean;
}

/**
 * Runs one AI analysis. The worker is the authority on budgets (the API pre-check can race).
 * Every provider call that consumed tokens is recorded in UsageRecord, even if it failed.
 */
export async function processAiAnalysis(deps: WorkerDeps, job: AnalysisJobContext) {
  const { prisma } = deps;
  const analysis = await prisma.aIAnalysis.findUnique({
    where: { id: job.analysisId },
    include: { organization: { select: { aiMonthlyBudgetUsd: true } } },
  });
  if (!analysis || (analysis.status !== 'PENDING' && analysis.status !== 'RUNNING')) {
    return { skipped: true, reason: 'not pending' };
  }

  if (!deps.ai.isConfigured()) {
    await finish(deps, analysis.id, {
      status: 'NOT_CONFIGURED',
      errorMessage: 'AI analysis is not configured: set ANTHROPIC_API_KEY on the worker.',
    });
    return { status: 'NOT_CONFIGURED' };
  }

  const spent = await prisma.usageRecord.aggregate({
    where: { organizationId: analysis.organizationId, createdAt: { gte: monthStart() } },
    _sum: { costUsd: true },
  });
  if (Number(spent._sum.costUsd ?? 0) >= Number(analysis.organization.aiMonthlyBudgetUsd)) {
    await finish(deps, analysis.id, {
      status: 'BUDGET_EXCEEDED',
      errorMessage: 'Monthly AI budget reached.',
    });
    return { status: 'BUDGET_EXCEEDED' };
  }

  const target = await loadTarget(deps, analysis);
  if (!target) {
    await finish(deps, analysis.id, {
      status: 'FAILED',
      errorMessage: 'The analysed item no longer exists.',
    });
    return { status: 'FAILED' };
  }

  await prisma.aIAnalysis.update({ where: { id: analysis.id }, data: { status: 'RUNNING' } });
  try {
    const outcome = await runAnalysis(deps.ai, target);
    await prisma.$transaction(async (tx) => {
      await tx.aIAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: 'COMPLETED',
          provider: outcome.provider,
          model: outcome.model,
          promptVersion: outcome.promptVersion,
          summary: outcome.result.summary.slice(0, 2000),
          severity: outcome.result.severity,
          result: {
            ...outcome.result,
            validationNotes: outcome.corrections,
          } as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      await recordUsage(
        tx,
        analysis.organizationId,
        analysis.id,
        outcome.provider,
        outcome.model,
        outcome.usage,
      );
      if (analysis.incidentId) {
        await tx.incidentEvent.create({
          data: {
            organizationId: analysis.organizationId,
            incidentId: analysis.incidentId,
            type: 'AI_ANALYSIS',
            actorId: analysis.requestedById,
            message:
              `AI analysis (hypotheses, not confirmed causes): ${outcome.result.summary}`.slice(
                0,
                4000,
              ),
          },
        });
      }
    });
    deps.metrics.aiCost.inc(outcome.costUsd);
    return { status: 'COMPLETED', costUsd: outcome.costUsd };
  } catch (error) {
    const providerError = error instanceof AIProviderError ? error : null;
    if (providerError?.usage) {
      await recordUsage(
        prisma,
        analysis.organizationId,
        analysis.id,
        deps.ai.name,
        providerError.usage.model,
        providerError.usage,
      );
    }
    const retry = providerError?.retryable === true && !job.finalAttempt;
    if (retry) {
      await prisma.aIAnalysis.update({
        where: { id: analysis.id },
        data: { status: 'PENDING', errorMessage: `Retrying: ${providerError!.message}` },
      });
      throw error; // BullMQ retries with exponential backoff
    }
    const message = providerError
      ? `${providerError.kind}: ${providerError.message}`
      : 'Unexpected error while analysing';
    deps.logger.warn({ err: error, analysisId: analysis.id }, 'AI analysis failed');
    await finish(deps, analysis.id, { status: 'FAILED', errorMessage: message.slice(0, 1000) });
    return { status: 'FAILED' };
  }
}

async function finish(
  deps: WorkerDeps,
  id: string,
  data: { status: 'FAILED' | 'NOT_CONFIGURED' | 'BUDGET_EXCEEDED'; errorMessage: string },
) {
  await deps.prisma.aIAnalysis.update({
    where: { id },
    data: { ...data, completedAt: new Date() },
  });
}

async function recordUsage(
  db: Prisma.TransactionClient | WorkerDeps['prisma'],
  organizationId: string,
  aiAnalysisId: string,
  provider: string,
  model: string,
  usage: TokenUsage,
) {
  await db.usageRecord.create({
    data: {
      organizationId,
      aiAnalysisId,
      provider,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costUsd: costUsd(model, usage),
    },
  });
}

const toContextLog = (l: {
  timestamp: Date;
  severity: string;
  environment: string;
  message: string;
}): ContextLog => ({
  timestamp: l.timestamp,
  severity: l.severity,
  environment: l.environment,
  message: l.message,
});

/** Builds the bounded, structured input for the model. Only selected fields ever leave the DB. */
async function loadTarget(
  deps: WorkerDeps,
  analysis: { organizationId: string; incidentId: string | null; errorGroupId: string | null },
): Promise<AnalysisTarget | null> {
  const { prisma } = deps;
  if (analysis.incidentId) {
    const incident = await prisma.incident.findFirst({
      where: { id: analysis.incidentId, organizationId: analysis.organizationId },
      include: {
        application: { select: { name: true, environment: true } },
        monitor: {
          select: {
            id: true,
            name: true,
            method: true,
            url: true,
            expectedStatusCodes: true,
            timeoutMs: true,
            latencyThresholdMs: true,
          },
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          where: { type: { not: 'AI_ANALYSIS' } },
        },
      },
    });
    if (!incident) return null;
    const windowStart = new Date(incident.openedAt.getTime() - LOG_WINDOW_MS);
    const windowEnd = incident.resolvedAt ?? new Date();
    const [checks, logs] = await Promise.all([
      incident.monitorId
        ? prisma.monitorCheck.findMany({
            where: { monitorId: incident.monitorId, checkedAt: { lte: windowEnd } },
            orderBy: { checkedAt: 'desc' },
            take: 30,
          })
        : Promise.resolve([]),
      prisma.log.findMany({
        where: {
          applicationId: incident.applicationId,
          severity: { in: ['WARN', 'ERROR', 'FATAL'] },
          timestamp: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { timestamp: 'desc' },
        take: 25,
        select: { timestamp: true, severity: true, environment: true, message: true },
      }),
    ]);
    return {
      kind: 'incident',
      input: {
        incident: {
          title: incident.title,
          status: incident.status,
          severity: incident.severity,
          source: incident.source,
          openedAt: incident.openedAt,
          resolvedAt: incident.resolvedAt,
          probableCause: incident.probableCause,
        },
        application: incident.application,
        monitor: incident.monitor,
        checks,
        events: incident.events,
        logs: logs.map(toContextLog),
      },
    };
  }
  if (analysis.errorGroupId) {
    const group = await prisma.errorGroup.findFirst({
      where: { id: analysis.errorGroupId, organizationId: analysis.organizationId },
      include: { application: { select: { name: true, environment: true } } },
    });
    if (!group) return null;
    const [samples, hourlyCounts] = await Promise.all([
      prisma.log.findMany({
        where: { errorGroupId: group.id },
        orderBy: { timestamp: 'desc' },
        take: 15,
        select: { timestamp: true, severity: true, environment: true, message: true },
      }),
      prisma.$queryRaw<{ hour: Date; count: number }[]>`
        SELECT date_trunc('hour', "timestamp") AS hour, COUNT(*)::int AS count FROM "Log"
        WHERE "errorGroupId" = ${group.id}::uuid AND "timestamp" > now() - interval '48 hours'
        GROUP BY 1 ORDER BY 1 DESC`,
    ]);
    return {
      kind: 'errorGroup',
      input: {
        group,
        application: group.application,
        samples: samples.map(toContextLog),
        hourlyCounts,
      },
    };
  }
  return null;
}
