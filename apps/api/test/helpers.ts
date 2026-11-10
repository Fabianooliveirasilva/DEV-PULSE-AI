import type { INestApplication } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@devpulse/database';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent.js';
import { createApp } from '../src/bootstrap.js';
import { type Env, loadEnv } from '../src/config/env.js';

export const ORIGIN = 'http://localhost:3000';
export const DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://devpulse:devpulse@localhost:54329/devpulse_test';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: DB_URL,
    QUEUE_BACKEND: process.env.TEST_QUEUE_BACKEND ?? 'postgres',
    REDIS_URL: process.env.TEST_REDIS_URL ?? '',
    WEB_ORIGINS: ORIGIN,
    WEB_PUBLIC_URL: ORIGIN,
    MAIL_OUTBOX_DIR: mkdtempSync(join(tmpdir(), 'devpulse-mail-')),
    SSRF_ALLOWLIST: '',
    RATE_LIMIT_DISABLED: 'true',
    LOG_LEVEL: 'fatal',
    ...overrides,
  });
}

export interface TestContext {
  app: INestApplication;
  env: Env;
  prisma: PrismaClient;
  close: () => Promise<void>;
}

export async function startApp(overrides: Record<string, string> = {}): Promise<TestContext> {
  const env = testEnv(overrides);
  const app = await createApp(env, { logger: false });
  await app.init();
  const prisma = createPrismaClient({ connectionString: DB_URL, maxConnections: 3 });
  return {
    app,
    env,
    prisma,
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/** Wipes every application table (keeps the migrations table). */
export async function resetDb(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/** Cookie-persisting client that sends the allowed Origin on state-changing requests (like a browser would). */
export function browser(app: INestApplication) {
  const agent = request.agent(app.getHttpServer()) as TestAgent;
  return {
    agent,
    get: (url: string) => agent.get(`/api/v1${url}`),
    post: (url: string, body?: object) =>
      agent
        .post(`/api/v1${url}`)
        .set('Origin', ORIGIN)
        .send(body ?? {}),
    patch: (url: string, body: object) =>
      agent.patch(`/api/v1${url}`).set('Origin', ORIGIN).send(body),
    delete: (url: string) => agent.delete(`/api/v1${url}`).set('Origin', ORIGIN),
  };
}
export type Browser = ReturnType<typeof browser>;

let counter = 0;
export async function signUp(app: INestApplication, name = 'User') {
  const client = browser(app);
  const email = `${name.toLowerCase().replace(/\W/g, '')}${Date.now()}${counter++}@example.com`;
  const password = 'correct horse battery staple';
  const res = await client.post('/auth/register', {
    name,
    email,
    password,
    organizationName: `${name} Org`,
  });
  if (res.status !== 201)
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  const me = await client.get('/auth/me');
  const orgId = me.body.organizations[0].id as string;
  const projects = await client.get(`/orgs/${orgId}/projects`);
  return {
    client,
    email,
    password,
    userId: res.body.id as string,
    orgId,
    projectId: projects.body[0].id as string,
  };
}

export async function createApplication(
  client: Browser,
  orgId: string,
  projectId: string,
  name = 'Checkout API',
  environment = 'PRODUCTION',
) {
  const res = await client.post(`/orgs/${orgId}/applications`, { projectId, name, environment });
  if (res.status !== 201)
    throw new Error(`create app failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

export function readOutbox(dir: string): { to: string; subject: string; text: string }[] {
  return readdirSync(dir)
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}
