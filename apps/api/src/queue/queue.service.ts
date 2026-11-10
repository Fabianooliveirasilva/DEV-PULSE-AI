import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  type AiAnalysisJob,
  createQueueFactory,
  type MonitorCheckJob,
  type NotificationDeliveryJob,
  type Queue,
  type QueueFactory,
  QUEUES,
} from '@devpulse/queue';
import { ENV, type Env } from '../config/env.js';

/** Producer side only: the API enqueues; apps/worker consumes. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly factory: QueueFactory;
  readonly monitorChecks: Queue<MonitorCheckJob>;
  readonly aiAnalysis: Queue<AiAnalysisJob>;
  readonly notifications: Queue<NotificationDeliveryJob>;

  constructor(@Inject(ENV) env: Env) {
    this.factory = createQueueFactory({
      backend: env.QUEUE_BACKEND,
      redisUrl: env.REDIS_URL,
      databaseUrl: env.DATABASE_URL,
    });
    this.monitorChecks = this.factory.createQueue<MonitorCheckJob>(QUEUES.monitorChecks);
    this.aiAnalysis = this.factory.createQueue<AiAnalysisJob>(QUEUES.aiAnalysis, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    });
    this.notifications = this.factory.createQueue<NotificationDeliveryJob>(QUEUES.notifications, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    });
    for (const q of [this.monitorChecks, this.aiAnalysis, this.notifications]) {
      q.on('error', (err) => this.logger.error({ err }, `Queue ${q.name} error`));
    }
  }

  get backend() {
    return this.factory.backend;
  }

  /** Readiness probe: the queue backend must accept a cheap command. */
  async ping(): Promise<boolean> {
    try {
      await this.monitorChecks.getJobCounts('waiting');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await Promise.allSettled([
      this.monitorChecks.close(),
      this.aiAnalysis.close(),
      this.notifications.close(),
    ]);
    await this.factory.close();
  }
}
