import type { NotificationType } from '@devpulse/database';
import { safeHttpRequest } from '@devpulse/shared/node';
import { UnrecoverableError, type NotificationDeliveryJob } from '@devpulse/queue';
import type { WorkerDeps } from '../deps.js';

export interface PendingDelivery {
  channels: { id: string }[];
  organizationId: string;
  type: NotificationType;
  title: string;
  body: string;
  incidentId: string | null;
}

export async function enqueueDeliveries(deps: WorkerDeps, deliveries: PendingDelivery[]) {
  const jobs = deliveries.flatMap((d) =>
    d.channels.map((c) => ({
      name: 'deliver',
      data: {
        channelId: c.id,
        organizationId: d.organizationId,
        notificationType: d.type,
        title: d.title,
        body: d.body,
        link: d.incidentId ? `/incidents/${d.incidentId}` : null,
      } satisfies NotificationDeliveryJob,
    })),
  );
  if (jobs.length > 0) await deps.notifications.addBulk(jobs);
}

/**
 * Delivers one notification to an external channel. Failures throw so BullMQ retries
 * with backoff; configuration problems throw UnrecoverableError (retrying cannot help).
 */
export async function processNotificationDelivery(
  deps: WorkerDeps,
  job: NotificationDeliveryJob,
  webBaseUrl: string,
) {
  const channel = await deps.prisma.notificationChannel.findFirst({
    where: { id: job.channelId, organizationId: job.organizationId },
  });
  if (!channel || !channel.isEnabled) return { skipped: true };
  const link = job.link ? `${webBaseUrl}${job.link}` : null;

  if (channel.type === 'EMAIL') {
    if (!deps.mail.isConfigured)
      throw new UnrecoverableError('E-mail transport is not configured (SMTP_URL)');
    await deps.mail.send({
      to: channel.target,
      subject: `[DevPulse AI] ${job.title}`,
      text: `${job.body}${link ? `\n\nOpen in DevPulse AI: ${link}` : ''}`,
    });
    return { delivered: 'email' };
  }

  const http = deps.http ?? safeHttpRequest;
  const outcome = await http({
    url: channel.target,
    method: 'POST',
    timeoutMs: 10_000,
    maxRedirects: 0,
    policy: { allowlist: deps.ssrfAllowlist },
    userAgent: 'DevPulseAI-Webhook/1.0',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: job.notificationType,
      title: job.title,
      body: job.body,
      link,
      sentAt: new Date().toISOString(),
    }),
  });
  if (outcome.errorType === 'BLOCKED_DESTINATION')
    throw new UnrecoverableError(`Webhook destination blocked: ${outcome.errorMessage}`);
  if (outcome.statusCode === null || outcome.statusCode < 200 || outcome.statusCode >= 300) {
    throw new Error(
      `Webhook delivery failed: ${outcome.errorMessage ?? `HTTP ${outcome.statusCode}`}`,
    );
  }
  return { delivered: 'webhook', statusCode: outcome.statusCode };
}
