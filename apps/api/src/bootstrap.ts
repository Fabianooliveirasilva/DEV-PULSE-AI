import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

/** Builds a fully configured app. Shared by main.ts and the API/integration tests. */
export async function createApp(
  env: Env,
  options: { logger?: boolean } = {},
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bodyParser: false,
    bufferLogs: true,
    logger: options.logger === false ? false : undefined,
  });
  if (options.logger !== false) app.useLogger(app.get(Logger));

  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // The only HTML served by the API is Swagger UI.
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  // Payload limits: ingestion batches may be larger; everything else is small JSON.
  app.use('/api/v1/ingest', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.enableCors({
    origin: env.WEB_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-request-id'],
    maxAge: 600,
  });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('DevPulse AI API')
      .setDescription(
        'Monitoring, incidents, logs and AI error intelligence. Session cookie auth; log ingestion uses X-DevPulse-Key.',
      )
      .setVersion('0.1.0')
      .addCookieAuth('dp_session')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-DevPulse-Key' }, 'ingestKey')
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
  }
  return app;
}
