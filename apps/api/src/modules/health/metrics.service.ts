import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import { finalize, type Observable } from 'rxjs';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration = new Histogram({
    name: 'devpulse_api_http_request_duration_seconds',
    help: 'HTTP request duration by route and status',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  readonly logsIngested = new Counter({
    name: 'devpulse_api_logs_ingested_total',
    help: 'Log events accepted by the ingestion endpoint',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'devpulse_api_' });
  }
}

/** Records request latency labelled by the route *template* (bounded cardinality, no ids). */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const end = this.metrics.httpDuration.startTimer();
    return next.handle().pipe(
      finalize(() => {
        const route = (req.route as { path?: string } | undefined)?.path ?? 'unmatched';
        end({ method: req.method, route, status: String(http.getResponse<Response>().statusCode) });
      }),
    );
  }
}
