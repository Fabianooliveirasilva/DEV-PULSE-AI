import {
  Controller,
  Get,
  Inject,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  Headers,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { safeEqualHex, sha256Hex } from '@devpulse/shared/node';
import { Public } from '../../common/context.js';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { MetricsService } from './metrics.service.js';

@ApiTags('health')
@SkipThrottle()
@Public()
@Controller()
export class HealthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly queues: QueueService,
    private readonly metrics: MetricsService,
  ) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. Used by orchestrators and docker-compose healthchecks. */
  @Get('health/ready')
  async ready() {
    const [db, queue] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.queues.ping(),
    ]);
    const body = {
      status: db && queue ? 'ok' : 'degraded',
      checks: { database: db, queue, queueBackend: this.queues.backend },
    };
    if (!db || !queue) throw new ServiceUnavailableException(body);
    return body;
  }

  /** Prometheus scrape endpoint. Disabled unless METRICS_TOKEN is set; requires it as a bearer token. */
  @ApiExcludeEndpoint()
  @Get('metrics')
  async scrape(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    if (!this.env.METRICS_TOKEN) throw new UnauthorizedException('Metrics are disabled');
    const presented = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!safeEqualHex(sha256Hex(presented), sha256Hex(this.env.METRICS_TOKEN)))
      throw new UnauthorizedException();
    res.setHeader('content-type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}
