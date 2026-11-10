import { createServer, type Server } from 'node:http';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { safeEqualHex, sha256Hex } from '@devpulse/shared/node';

export function createWorkerMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'devpulse_worker_' });
  return {
    registry,
    checks: new Counter({
      name: 'devpulse_worker_monitor_checks_total',
      help: 'Monitor checks executed, by result',
      labelNames: ['result'] as const,
      registers: [registry],
    }),
    checkLatency: new Histogram({
      name: 'devpulse_worker_monitor_check_latency_seconds',
      help: 'Observed HTTP latency of successful monitor checks',
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [registry],
    }),
    jobs: new Counter({
      name: 'devpulse_worker_jobs_total',
      help: 'Processed jobs by queue and outcome',
      labelNames: ['queue', 'outcome'] as const,
      registers: [registry],
    }),
    aiCost: new Counter({
      name: 'devpulse_worker_ai_cost_usd_total',
      help: 'Accumulated AI spend in USD',
      registers: [registry],
    }),
    incidentsOpened: new Counter({
      name: 'devpulse_worker_incidents_opened_total',
      help: 'Incidents opened automatically',
      registers: [registry],
    }),
    activeMonitors: new Gauge({
      name: 'devpulse_worker_active_monitors',
      help: 'Monitors with an active scheduler (set at reconciliation)',
      registers: [registry],
    }),
  };
}

export type WorkerMetrics = ReturnType<typeof createWorkerMetrics>;

/** Minimal scrape endpoint (`/metrics`, bearer token) plus `/health` for container probes. */
export function startMetricsServer(
  metrics: WorkerMetrics,
  port: number,
  token: string | undefined,
): Server {
  const server = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
      return;
    }
    if (req.url === '/metrics' && token) {
      const presented = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : '';
      if (!safeEqualHex(sha256Hex(presented), sha256Hex(token))) {
        res.writeHead(401).end();
        return;
      }
      res
        .writeHead(200, { 'content-type': metrics.registry.contentType })
        .end(await metrics.registry.metrics());
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, '0.0.0.0');
  return server;
}
