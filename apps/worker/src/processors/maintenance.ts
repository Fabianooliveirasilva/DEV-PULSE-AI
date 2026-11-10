import { notifyOrganization } from '@devpulse/database';
import type { WorkerDeps } from '../deps.js';
import { enqueueDeliveries, type PendingDelivery } from './notify.js';

const DELETE_BATCH = 5_000;

/**
 * Retention: deletes logs and checks older than each organisation's policy, in bounded
 * batches so a large backlog never holds long locks. Also purges expired auth artefacts.
 */
export async function runRetention(deps: WorkerDeps, now = new Date()) {
  const { prisma } = deps;
  const orgs = await prisma.organization.findMany({
    select: { id: true, logRetentionDays: true, checkRetentionDays: true },
  });
  let logs = 0;
  let checks = 0;
  for (const org of orgs) {
    const logCutoff = new Date(now.getTime() - org.logRetentionDays * 86_400_000);
    const checkCutoff = new Date(now.getTime() - org.checkRetentionDays * 86_400_000);
    logs += await deleteInBatches(
      () =>
        prisma.$executeRaw`DELETE FROM "Log" WHERE "id" IN (SELECT "id" FROM "Log" WHERE "organizationId" = ${org.id}::uuid AND "timestamp" < ${logCutoff} LIMIT ${DELETE_BATCH})`,
    );
    // Checks linked to an incident are kept as incident evidence until the incident itself is deleted.
    checks += await deleteInBatches(
      () =>
        prisma.$executeRaw`DELETE FROM "MonitorCheck" WHERE "id" IN (SELECT "id" FROM "MonitorCheck" WHERE "organizationId" = ${org.id}::uuid AND "checkedAt" < ${checkCutoff} AND "incidentId" IS NULL LIMIT ${DELETE_BATCH})`,
    );
    await prisma.errorGroup.deleteMany({
      where: { organizationId: org.id, lastSeenAt: { lt: logCutoff }, aiAnalyses: { none: {} } },
    });
  }
  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const tokens = await prisma.passwordResetToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
  });
  return { logs, checks, sessions: sessions.count, resetTokens: tokens.count };
}

async function deleteInBatches(run: () => Promise<number>) {
  let total = 0;
  for (;;) {
    const deleted = await run();
    total += deleted;
    if (deleted < DELETE_BATCH) return total;
  }
}

export interface SpikeOptions {
  windowMinutes: number;
  baselineMinutes: number;
  minCount: number;
  factor: number;
}

const DEFAULT_SPIKE: SpikeOptions = {
  windowMinutes: 5,
  baselineMinutes: 60,
  minCount: 10,
  factor: 3,
};

/**
 * Error-rate spike detection per error group: the last window must have at least
 * `minCount` occurrences and `factor`× the average of the preceding baseline windows.
 * At most one spike notification per group every 30 minutes.
 */
export async function scanErrorSpikes(
  deps: WorkerDeps,
  now = new Date(),
  opts: SpikeOptions = DEFAULT_SPIKE,
) {
  const { prisma } = deps;
  const windowStart = new Date(now.getTime() - opts.windowMinutes * 60_000);
  const baselineStart = new Date(windowStart.getTime() - opts.baselineMinutes * 60_000);
  const rows = await prisma.$queryRaw<{ group_id: string; recent: number; baseline: number }[]>`
    SELECT "errorGroupId" AS group_id,
           COUNT(*) FILTER (WHERE "timestamp" >= ${windowStart})::int AS recent,
           COUNT(*) FILTER (WHERE "timestamp" < ${windowStart})::int AS baseline
    FROM "Log"
    WHERE "errorGroupId" IS NOT NULL AND "timestamp" >= ${baselineStart} AND "timestamp" <= ${now}
    GROUP BY 1
    HAVING COUNT(*) FILTER (WHERE "timestamp" >= ${windowStart}) >= ${opts.minCount}`;

  const windowsInBaseline = opts.baselineMinutes / opts.windowMinutes;
  const deliveries: PendingDelivery[] = [];
  let spikes = 0;
  for (const row of rows) {
    const baselineAvg = row.baseline / windowsInBaseline;
    if (row.recent < opts.factor * Math.max(baselineAvg, 1)) continue;
    const group = await prisma.errorGroup.findUnique({
      where: { id: row.group_id },
      include: { application: { select: { id: true, name: true } } },
    });
    if (!group) continue;
    const title = `Error spike on ${group.application.name}`;
    const recentlyNotified = await prisma.notification.findFirst({
      where: {
        applicationId: group.applicationId,
        type: 'ERROR_SPIKE',
        title,
        body: { contains: group.id },
        createdAt: { gte: new Date(now.getTime() - 30 * 60_000) },
      },
      select: { id: true },
    });
    if (recentlyNotified) continue;
    const body = `"${group.title.slice(0, 200)}" occurred ${row.recent} times in ${opts.windowMinutes} min (baseline ≈ ${baselineAvg.toFixed(1)}). Group ${group.id}`;
    const channels = await notifyOrganization(prisma, {
      organizationId: group.organizationId,
      type: 'ERROR_SPIKE',
      title,
      body,
      applicationId: group.applicationId,
    });
    deliveries.push({
      channels,
      organizationId: group.organizationId,
      type: 'ERROR_SPIKE',
      title,
      body,
      incidentId: null,
    });
    spikes++;
  }
  await enqueueDeliveries(deps, deliveries);
  return { spikes };
}
