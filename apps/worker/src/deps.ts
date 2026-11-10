import type { AIProvider } from '@devpulse/ai';
import type { PrismaClient } from '@devpulse/database';
import type { NotificationDeliveryJob, Queue } from '@devpulse/queue';
import type { safeHttpRequest } from '@devpulse/shared/node';
import type { Logger } from 'pino';
import type { WorkerMetrics } from './metrics.js';

/** Everything a processor needs, injected so integration tests can swap pieces. */
export interface WorkerDeps {
  prisma: PrismaClient;
  logger: Logger;
  metrics: WorkerMetrics;
  ssrfAllowlist: readonly string[];
  notifications: Pick<Queue<NotificationDeliveryJob>, 'addBulk'>;
  ai: AIProvider;
  mail: MailSender;
  /** Overridable for tests; defaults to safeHttpRequest. */
  http?: typeof safeHttpRequest;
}

export interface MailSender {
  isConfigured: boolean;
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}
