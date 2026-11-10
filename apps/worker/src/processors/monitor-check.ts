import { notifyOrganization, type NotificationType } from '@devpulse/database';
import {
  type AppEnvironment,
  applyCheck,
  classifyOutcome,
  type MonitorStatus,
  severityForOutage,
} from '@devpulse/shared';
import { safeHttpRequest } from '@devpulse/shared/node';
import type { WorkerDeps } from '../deps.js';
import { enqueueDeliveries, type PendingDelivery } from './notify.js';

export interface CheckJobInput {
  monitorId: string;
  /** Unique per scheduled slot (the BullMQ job id). Retries reuse it → no duplicate rows. */
  idempotencyKey: string;
}

export type CheckOutcome =
  | { skipped: true; reason: string }
  | { skipped: false; result: string; action: string; status: MonitorStatus };

/**
 * One monitor check:
 *  1. HTTP request outside any transaction (it can take seconds).
 *  2. A short transaction that row-locks the monitor, so concurrent checks of the same
 *     monitor (scheduled + manual) serialise their state updates.
 *  3. External notification deliveries are queued after commit.
 */
export async function processMonitorCheck(
  deps: WorkerDeps,
  input: CheckJobInput,
): Promise<CheckOutcome> {
  const { prisma } = deps;
  const monitor = await prisma.monitor.findUnique({
    where: { id: input.monitorId },
    include: { application: { select: { id: true, name: true, environment: true } } },
  });
  if (!monitor) return { skipped: true, reason: 'monitor deleted' };
  if (!monitor.isActive) return { skipped: true, reason: 'monitor paused' };
  if (
    await prisma.monitorCheck.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    })
  ) {
    return { skipped: true, reason: 'already recorded' };
  }

  const http = deps.http ?? safeHttpRequest;
  const outcome = await http({
    url: monitor.url,
    method: monitor.method,
    timeoutMs: monitor.timeoutMs,
    policy: { allowlist: deps.ssrfAllowlist },
  });
  const classified = classifyOutcome(outcome, {
    expectedStatusCodes: monitor.expectedStatusCodes,
    latencyThresholdMs: monitor.latencyThresholdMs,
  });
  deps.metrics.checks.inc({ result: classified.result });
  if (classified.result !== 'DOWN' && outcome.latencyMs !== null)
    deps.metrics.checkLatency.observe(outcome.latencyMs / 1000);

  const deliveries: PendingDelivery[] = [];
  const result = await prisma.$transaction(async (tx) => {
    // Lock and re-read: state may have changed while the HTTP request was in flight.
    const locked = await tx.$queryRaw<
      {
        status: MonitorStatus;
        consecutiveFailures: number;
        failureThreshold: number;
        isActive: boolean;
      }[]
    >`
      SELECT "status", "consecutiveFailures", "failureThreshold", "isActive" FROM "Monitor" WHERE "id" = ${monitor.id}::uuid FOR UPDATE`;
    const state = locked[0];
    if (!state || !state.isActive)
      return { skipped: true as const, reason: 'monitor paused or deleted during check' };

    const openIncident = await tx.incident.findUnique({
      where: { activeMonitorId: monitor.id },
      select: { id: true },
    });
    const transition = applyCheck(
      { ...state, hasOpenIncident: Boolean(openIncident) },
      classified.result,
    );
    const now = new Date();

    const check = await tx.monitorCheck.create({
      data: {
        organizationId: monitor.organizationId,
        monitorId: monitor.id,
        idempotencyKey: input.idempotencyKey,
        result: classified.result,
        statusCode: outcome.statusCode,
        latencyMs: outcome.latencyMs,
        errorType: classified.errorType,
        errorMessage: classified.errorMessage?.slice(0, 500) ?? null,
        checkedAt: now,
        incidentId: openIncident?.id ?? null,
      },
    });
    await tx.monitor.update({
      where: { id: monitor.id },
      data: {
        status: transition.status,
        consecutiveFailures: transition.consecutiveFailures,
        lastCheckedAt: now,
        lastLatencyMs: outcome.latencyMs,
      },
    });

    const notify = async (
      type: NotificationType,
      title: string,
      body: string,
      incidentId: string | null,
    ) => {
      const channels = await notifyOrganization(tx, {
        organizationId: monitor.organizationId,
        type,
        title,
        body,
        incidentId,
        applicationId: monitor.applicationId,
      });
      deliveries.push({
        channels,
        organizationId: monitor.organizationId,
        type,
        title,
        body,
        incidentId,
      });
    };

    switch (transition.action.type) {
      case 'OPEN_INCIDENT': {
        const severity = severityForOutage(monitor.application.environment as AppEnvironment);
        const reason = classified.errorMessage ?? classified.errorType ?? 'check failed';
        const incident = await tx.incident.create({
          data: {
            organizationId: monitor.organizationId,
            applicationId: monitor.applicationId,
            monitorId: monitor.id,
            activeMonitorId: monitor.id,
            title: `${monitor.application.name}: ${monitor.name} is down`,
            severity,
            source: 'MONITOR',
          },
        });
        // Link the failing streak that triggered the incident (bounded by the threshold).
        const streak = await tx.monitorCheck.findMany({
          where: { monitorId: monitor.id, result: 'DOWN', incidentId: null },
          orderBy: { checkedAt: 'desc' },
          take: transition.consecutiveFailures,
          select: { id: true },
        });
        await tx.monitorCheck.updateMany({
          where: { id: { in: streak.map((s) => s.id) } },
          data: { incidentId: incident.id },
        });
        await tx.incidentEvent.create({
          data: {
            organizationId: monitor.organizationId,
            incidentId: incident.id,
            type: 'CREATED',
            message: `Opened automatically after ${transition.consecutiveFailures} consecutive failed checks. Last error: ${reason}`,
            toStatus: 'OPEN',
          },
        });
        deps.metrics.incidentsOpened.inc();
        await notify(
          'MONITOR_DOWN',
          `${monitor.application.name} is down`,
          `${monitor.name} (${monitor.method} ${monitor.url}) failed ${transition.consecutiveFailures} checks in a row: ${reason}`,
          incident.id,
        );
        if (severity === 'CRITICAL') {
          await notify(
            'INCIDENT_CRITICAL',
            `Critical incident: ${incident.title}`,
            `Production outage detected on ${monitor.application.name}.`,
            incident.id,
          );
        }
        break;
      }
      case 'RESOLVE_INCIDENT': {
        const incident = openIncident!;
        await tx.incident.update({
          where: { id: incident.id },
          data: { status: 'RESOLVED', resolvedAt: now, activeMonitorId: null },
        });
        await tx.incidentEvent.create({
          data: {
            organizationId: monitor.organizationId,
            incidentId: incident.id,
            type: 'RECOVERED',
            message: `Monitor recovered (HTTP ${outcome.statusCode}, ${outcome.latencyMs}ms). Incident resolved automatically.`,
            toStatus: 'RESOLVED',
          },
        });
        await notify(
          'MONITOR_RECOVERED',
          `${monitor.application.name} recovered`,
          `${monitor.name} is responding again (HTTP ${outcome.statusCode}).`,
          incident.id,
        );
        break;
      }
      case 'APPEND_FAILURE':
      case 'NONE':
        break;
    }
    if (transition.latencyBreached) {
      await notify(
        'LATENCY_THRESHOLD',
        `${monitor.name} is slow`,
        `Latency ${outcome.latencyMs}ms exceeded the ${monitor.latencyThresholdMs}ms threshold.`,
        null,
      );
    }
    return {
      skipped: false as const,
      result: check.result,
      action: transition.action.type,
      status: transition.status,
    };
  });

  await enqueueDeliveries(deps, deliveries);
  return result;
}
