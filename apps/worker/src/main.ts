import { AnthropicProvider } from '@devpulse/ai';
import { createPrismaClient } from '@devpulse/database';
import {
  type AiAnalysisJob,
  createQueueFactory,
  type MaintenanceJob,
  type MonitorCheckJob,
  monitorSchedulerId,
  type NotificationDeliveryJob,
  QUEUES,
  type Worker,
} from '@devpulse/queue';
import pino from 'pino';
import { loadConfig } from './config.js';
import type { WorkerDeps } from './deps.js';
import { createMailSender } from './mail.js';
import { createWorkerMetrics, startMetricsServer } from './metrics.js';
import { processAiAnalysis } from './processors/ai-analysis.js';
import { runRetention, scanErrorSpikes } from './processors/maintenance.js';
import { processMonitorCheck } from './processors/monitor-check.js';
import { processNotificationDelivery } from './processors/notify.js';

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, base: { service: 'worker' } });
const prisma = createPrismaClient({
  connectionString: config.DATABASE_URL,
  maxConnections: Math.min(config.WORKER_CONCURRENCY + 5, 30),
});
const queues = createQueueFactory({
  backend: config.QUEUE_BACKEND,
  redisUrl: config.REDIS_URL,
  databaseUrl: config.DATABASE_URL,
});
const metrics = createWorkerMetrics();

const monitorQueue = queues.createQueue<MonitorCheckJob>(QUEUES.monitorChecks);
const notificationQueue = queues.createQueue<NotificationDeliveryJob>(QUEUES.notifications, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
});
const maintenanceQueue = queues.createQueue<MaintenanceJob>(QUEUES.maintenance);

const deps: WorkerDeps = {
  prisma,
  logger,
  metrics,
  ssrfAllowlist: config.SSRF_ALLOWLIST,
  notifications: notificationQueue,
  ai: new AnthropicProvider({
    apiKey: config.ANTHROPIC_API_KEY || undefined,
    model: config.ANTHROPIC_MODEL,
    timeoutMs: config.AI_TIMEOUT_MS,
  }),
  mail: createMailSender(config),
};

function track<T>(worker: Worker<T>, queue: string) {
  worker.on('completed', () => metrics.jobs.inc({ queue, outcome: 'completed' }));
  worker.on('failed', (job, err) => {
    metrics.jobs.inc({ queue, outcome: 'failed' });
    logger.warn(
      { queue, jobId: job?.id, attempts: job?.attemptsMade, err: err.message },
      'job failed',
    );
  });
  // An error event must never crash the process: log it and keep consuming.
  worker.on('error', (err) => logger.error({ queue, err }, 'worker error'));
  return worker;
}

const workers = [
  track(
    queues.createWorker<MonitorCheckJob>(
      QUEUES.monitorChecks,
      async (job) =>
        processMonitorCheck(deps, { monitorId: job.data.monitorId, idempotencyKey: `${job.id}` }),
      // Checks are cheap and I/O-bound; concurrency bounds sockets and memory.
      { concurrency: config.WORKER_CONCURRENCY },
    ),
    QUEUES.monitorChecks,
  ),
  track(
    queues.createWorker<AiAnalysisJob>(
      QUEUES.aiAnalysis,
      async (job) =>
        processAiAnalysis(deps, {
          analysisId: job.data.analysisId,
          finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
        }),
      { concurrency: 2 },
    ),
    QUEUES.aiAnalysis,
  ),
  track(
    queues.createWorker<NotificationDeliveryJob>(
      QUEUES.notifications,
      async (job) => processNotificationDelivery(deps, job.data, config.WEB_PUBLIC_URL),
      {
        concurrency: 5,
      },
    ),
    QUEUES.notifications,
  ),
  track(
    queues.createWorker<MaintenanceJob>(
      QUEUES.maintenance,
      async (job) => (job.data.task === 'retention' ? runRetention(deps) : scanErrorSpikes(deps)),
      { concurrency: 1 },
    ),
    QUEUES.maintenance,
  ),
];

/**
 * Self-healing: makes the queue's schedulers match the database. Covers a flushed Redis,
 * monitors created while the queue was down, and schedulers of deleted monitors.
 */
async function reconcileSchedulers() {
  const active = await prisma.monitor.findMany({
    where: { isActive: true },
    select: { id: true, intervalSeconds: true },
  });
  const wanted = new Set(active.map((m) => monitorSchedulerId(m.id)));
  for (const m of active) {
    await monitorQueue.upsertJobScheduler(
      monitorSchedulerId(m.id),
      { every: m.intervalSeconds * 1000 },
      {
        name: 'check',
        data: { monitorId: m.id },
        opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
      },
    );
  }
  for (const scheduler of await monitorQueue.getJobSchedulers(0, -1)) {
    if (scheduler.key.startsWith('monitor:') && !wanted.has(scheduler.key))
      await monitorQueue.removeJobScheduler(scheduler.key);
  }
  metrics.activeMonitors.set(active.length);
  logger.info({ monitors: active.length }, 'monitor schedulers reconciled');
}

await reconcileSchedulers();
await maintenanceQueue.upsertJobScheduler(
  'retention',
  { pattern: '17 3 * * *' },
  { name: 'retention', data: { task: 'retention' } },
);
await maintenanceQueue.upsertJobScheduler(
  'error-spike-scan',
  { every: 5 * 60_000 },
  { name: 'error-spike-scan', data: { task: 'error-spike-scan' } },
);
const metricsServer = startMetricsServer(metrics, config.WORKER_METRICS_PORT, config.METRICS_TOKEN);
logger.info(
  { backend: queues.backend, concurrency: config.WORKER_CONCURRENCY, ai: deps.ai.isConfigured() },
  'worker started',
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down: finishing in-flight jobs');
  // Worker.close() waits for active jobs, so no check is half-recorded.
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([
    monitorQueue.close(),
    notificationQueue.close(),
    maintenanceQueue.close(),
  ]);
  await queues.close();
  await prisma.$disconnect();
  metricsServer.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
