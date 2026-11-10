import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { CsrfOriginGuard, OrgAccessGuard, SessionAuthGuard } from './common/guards.js';
import { AllExceptionsFilter } from './common/http-exception.filter.js';
import { AppThrottlerGuard, RedisThrottlerStorage } from './common/throttle.js';
import { ENV, type Env } from './config/env.js';
import { PrismaLifecycle, prismaProvider } from './database/prisma.service.js';
import { AiController } from './modules/ai/ai.controller.js';
import { ApplicationsController } from './modules/applications/applications.controller.js';
import { AuditService } from './modules/audit/audit.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import { PasswordService } from './modules/auth/password.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { DashboardController } from './modules/dashboard/dashboard.controller.js';
import { HealthController } from './modules/health/health.controller.js';
import { MetricsInterceptor, MetricsService } from './modules/health/metrics.service.js';
import { IncidentsController } from './modules/incidents/incidents.controller.js';
import { ApiKeyGuard } from './modules/logs/api-key.guard.js';
import { LogsController } from './modules/logs/logs.controller.js';
import { LogsService } from './modules/logs/logs.service.js';
import { MailService } from './modules/mail/mail.service.js';
import { MonitorSchedulerService } from './modules/monitors/monitor-scheduler.service.js';
import { MonitorsController } from './modules/monitors/monitors.controller.js';
import { NotificationDispatchService } from './modules/notifications/notification-dispatch.service.js';
import { NotificationsController } from './modules/notifications/notifications.controller.js';
import { OrganizationsController } from './modules/organizations/organizations.controller.js';
import { QueueService } from './queue/queue.service.js';

/**
 * One module on purpose: the API is a single deployable with ~10 feature areas whose
 * controllers are thin. Feature folders give the separation; Nest sub-modules would add
 * wiring without adding isolation.
 */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    const throttlerStorage = env.REDIS_URL ? new RedisThrottlerStorage(env.REDIS_URL) : undefined;
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id =
                typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming)
                  ? incoming
                  : randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            // Never write credentials to logs.
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'req.headers["x-devpulse-key"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
            autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
            transport:
              env.NODE_ENV === 'development'
                ? { target: 'pino/file', options: { destination: 1 } }
                : undefined,
          },
        }),
        ThrottlerModule.forRoot({
          throttlers: [
            { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_DISABLED ? 1_000_000 : 300 },
          ],
          storage: throttlerStorage,
          skipIf: () => env.RATE_LIMIT_DISABLED,
        }),
      ],
      controllers: [
        AuthController,
        OrganizationsController,
        ApplicationsController,
        MonitorsController,
        IncidentsController,
        LogsController,
        AiController,
        NotificationsController,
        DashboardController,
        HealthController,
      ],
      providers: [
        { provide: ENV, useValue: env },
        prismaProvider,
        PrismaLifecycle,
        // Registered as a provider only so Nest closes its Redis connection on shutdown.
        ...(throttlerStorage
          ? [{ provide: RedisThrottlerStorage, useValue: throttlerStorage }]
          : []),
        QueueService,
        SessionService,
        PasswordService,
        AuthService,
        MailService,
        AuditService,
        MonitorSchedulerService,
        NotificationDispatchService,
        LogsService,
        ApiKeyGuard,
        MetricsService,
        // Guard order matters: rate limit → CSRF → session → tenant/RBAC.
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
        { provide: APP_GUARD, useClass: CsrfOriginGuard },
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        { provide: APP_GUARD, useClass: OrgAccessGuard },
        { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
