import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  browser,
  createApplication,
  ORIGIN,
  resetDb,
  signUp,
  startApp,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startApp();
});
afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.prisma));

describe('CSRF protection (cookie-authenticated writes)', () => {
  it('rejects writes without an Origin/Referer or from a foreign origin', async () => {
    const { client, orgId } = await signUp(ctx.app);
    const noOrigin = await client.agent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'x' });
    const evil = await client.agent
      .post(`/api/v1/orgs/${orgId}/projects`)
      .set('Origin', 'https://evil.example')
      .send({ name: 'x' });
    const viaReferer = await client.agent
      .post(`/api/v1/orgs/${orgId}/projects`)
      .set('Referer', `${ORIGIN}/settings`)
      .send({ name: 'ok' });
    expect(noOrigin.status).toBe(403);
    expect(evil.status).toBe(403);
    expect(viaReferer.status).toBe(201);
  });

  it('allows safe methods without Origin', async () => {
    const { client } = await signUp(ctx.app);
    expect((await client.agent.get('/api/v1/auth/me')).status).toBe(200);
  });
});

describe('SSRF protection on monitor URLs', () => {
  it.each([
    'http://127.0.0.1:8080/',
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://metadata.google.internal/',
    'http://0x7f000001/',
  ])('rejects %s', async (url) => {
    const { client, orgId, projectId } = await signUp(ctx.app);
    const appId = await createApplication(client, orgId, projectId);
    const res = await client.post(`/orgs/${orgId}/monitors`, {
      applicationId: appId,
      name: 'm',
      url,
    });
    expect(res.status).toBe(400);
    expect(await ctx.prisma.monitor.count()).toBe(0);
  });

  it('rejects non-http schemes and embedded credentials at validation', async () => {
    const { client, orgId, projectId } = await signUp(ctx.app);
    const appId = await createApplication(client, orgId, projectId);
    for (const url of ['file:///etc/passwd', 'gopher://x', 'https://user:pass@example.com']) {
      expect(
        (await client.post(`/orgs/${orgId}/monitors`, { applicationId: appId, name: 'm', url }))
          .status,
      ).toBe(400);
    }
  });

  it('blocks private webhook targets', async () => {
    const { client, orgId } = await signUp(ctx.app);
    const res = await client.post(`/orgs/${orgId}/notification-channels`, {
      type: 'WEBHOOK',
      name: 'hook',
      target: 'http://10.1.2.3/hook',
      events: ['MONITOR_DOWN'],
    });
    expect(res.status).toBe(400);
  });
});

describe('input & payload limits', () => {
  it('returns 413 for oversized JSON bodies', async () => {
    const { client, orgId } = await signUp(ctx.app);
    const res = await client.post(`/orgs/${orgId}/projects`, { name: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
  });

  it('returns 400 for malformed JSON without leaking internals', async () => {
    const { client, orgId } = await signUp(ctx.app);
    const res = await client.agent
      .post(`/api/v1/orgs/${orgId}/projects`)
      .set('Origin', ORIGIN)
      .set('content-type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|node_modules/);
  });

  it('rejects SQL-injection-shaped input as plain data', async () => {
    const { client, orgId } = await signUp(ctx.app);
    const res = await client.get(
      `/orgs/${orgId}/logs?q=${encodeURIComponent('\'; DROP TABLE "Log"; --')}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(await ctx.prisma.log.count()).toBe(0); // table still exists
  });
});

describe('HTTP hardening', () => {
  it('sets security headers and hides the framework', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('restricts CORS to the configured web origin', async () => {
    const allowed = await request(ctx.app.getHttpServer())
      .options('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    const denied = await request(ctx.app.getHttpServer())
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('protects /metrics with a bearer token', async () => {
    const local = await (
      await import('./helpers.js')
    ).startApp({ METRICS_TOKEN: 'metrics-token-0123456789' });
    try {
      const server = local.app.getHttpServer();
      expect((await request(server).get('/api/v1/metrics')).status).toBe(401);
      expect(
        (
          await request(server)
            .get('/api/v1/metrics')
            .set('Authorization', 'Bearer wrong-token-0123456789')
        ).status,
      ).toBe(401);
      const ok = await request(server)
        .get('/api/v1/metrics')
        .set('Authorization', 'Bearer metrics-token-0123456789');
      expect(ok.status).toBe(200);
      expect(ok.text).toContain('devpulse_api_http_request_duration_seconds');
    } finally {
      await local.close();
    }
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts with 429', async () => {
    const limited = await (await import('./helpers.js')).startApp({ RATE_LIMIT_DISABLED: 'false' });
    try {
      const client = browser(limited.app);
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++)
        statuses.push(
          (await client.post('/auth/login', { email: 'a@example.com', password: 'nope-nope-nope' }))
            .status,
        );
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('health', () => {
  it('reports readiness of database and queue', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks).toMatchObject({ database: true, queue: true });
  });
});
