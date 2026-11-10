import {
  createPostgresBackend,
  Queue,
  withBackend,
  Worker,
  type JobsOptions,
  type Processor,
  type QueueOptions,
  type WorkerOptions,
} from 'bullmq';
import { Redis } from 'ioredis';

// ───────── queue names & payloads (the contract between API and worker) ─────────

export const QUEUES = {
  monitorChecks: 'monitor-checks',
  aiAnalysis: 'ai-analysis',
  notifications: 'notification-delivery',
  maintenance: 'maintenance',
} as const;

export interface MonitorCheckJob {
  monitorId: string;
}

export interface AiAnalysisJob {
  analysisId: string;
}

export interface NotificationDeliveryJob {
  channelId: string;
  notificationType: string;
  title: string;
  body: string;
  organizationId: string;
  link: string | null;
}

export type MaintenanceJob = { task: 'retention' } | { task: 'error-spike-scan' };

export const monitorSchedulerId = (monitorId: string) => `monitor:${monitorId}`;

// ───────── backend selection ─────────

export type QueueBackend = 'redis' | 'postgres';

export interface QueueConnectionConfig {
  backend: QueueBackend;
  redisUrl?: string;
  databaseUrl?: string;
  /** Postgres backend only: schema holding BullMQ tables (kept apart from app tables). */
  postgresSchema?: string;
  prefix?: string;
}

export interface QueueFactory {
  backend: QueueBackend;
  createQueue<T>(name: string, defaultJobOptions?: JobsOptions): Queue<T>;
  createWorker<T>(
    name: string,
    processor: Processor<T>,
    options?: Omit<WorkerOptions, 'connection'>,
  ): Worker<T>;
  close(): Promise<void>;
}

/**
 * Redis is the production backend. The PostgreSQL backend is BullMQ's own adapter and
 * exists for environments without Redis (local machines, constrained CI). Application
 * code is identical for both: only this factory knows the difference.
 */
export function createQueueFactory(config: QueueConnectionConfig): QueueFactory {
  const prefix = config.prefix ?? 'devpulse';
  if (config.backend === 'postgres') {
    if (!config.databaseUrl) throw new Error('QUEUE_BACKEND=postgres requires DATABASE_URL');
    const pg = withBackend(createPostgresBackend);
    // BullMQ owns and migrates its own schema, separate from the Prisma-managed tables.
    const connection = {
      connectionString: config.databaseUrl,
      schema: config.postgresSchema ?? 'bullmq',
      migrate: true,
    };
    return {
      backend: 'postgres',
      createQueue: <T>(name: string, defaultJobOptions?: JobsOptions) =>
        new pg.Queue<T>(name, { connection, prefix, defaultJobOptions }) as unknown as Queue<T>,
      createWorker: <T>(
        name: string,
        processor: Processor<T>,
        options?: Omit<WorkerOptions, 'connection'>,
      ) =>
        new pg.Worker<T>(name, processor as never, {
          ...options,
          connection,
          prefix,
        }) as unknown as Worker<T>,
      close: async () => {},
    };
  }

  if (!config.redisUrl) throw new Error('QUEUE_BACKEND=redis requires REDIS_URL');
  const clients: Redis[] = [];
  const client = () => {
    // BullMQ workers require maxRetriesPerRequest=null for blocking commands.
    const c = new Redis(config.redisUrl!, { maxRetriesPerRequest: null, lazyConnect: false });
    clients.push(c);
    return c;
  };
  return {
    backend: 'redis',
    createQueue: <T>(name: string, defaultJobOptions?: JobsOptions) =>
      new Queue<T>(name, { connection: client(), prefix, defaultJobOptions } as QueueOptions),
    createWorker: <T>(
      name: string,
      processor: Processor<T>,
      options?: Omit<WorkerOptions, 'connection'>,
    ) =>
      new Worker<T>(name, processor, { ...options, connection: client(), prefix } as WorkerOptions),
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.quit()));
    },
  };
}

export type { Job, JobsOptions, Processor, Queue, Worker } from 'bullmq';
export { UnrecoverableError } from 'bullmq';
