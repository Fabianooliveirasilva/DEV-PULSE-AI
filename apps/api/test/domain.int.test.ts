import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApplication, resetDb, signUp, startApp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startApp();
});
afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.prisma));

async function setup() {
  const user = await signUp(ctx.app);
  const appId = await createApplication(user.client, user.orgId, user.projectId);
  return { ...user, appId, base: `/orgs/${user.orgId}` };
}

describe('applications & monitors', () => {
  it('creates a monitor with defaults, schedules it, and validates updates', async () => {
    const { client, base, appId } = await setup();
    const created = await client.post(`${base}/monitors`, {
      applicationId: appId,
      name: 'Health',
      url: 'https://example.com/health',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      method: 'GET',
      intervalSeconds: 60,
      failureThreshold: 3,
      status: 'PENDING',
      isActive: true,
    });

    const bad = await client.patch(`${base}/monitors/${created.body.id}`, {
      timeoutMs: 30_000,
      intervalSeconds: 30,
    });
    expect(bad.status).toBe(400);
    const paused = await client.patch(`${base}/monitors/${created.body.id}`, { isActive: false });
    expect(paused.body.status).toBe('PAUSED');
    expect((await client.post(`${base}/monitors/${created.body.id}/run`)).status).toBe(400);
  });

  it('aggregates application status from its monitors and computes uptime from stored checks', async () => {
    const { client, base, appId, orgId } = await setup();
    const monitor = (
      await client.post(`${base}/monitors`, {
        applicationId: appId,
        name: 'Health',
        url: 'https://example.com/',
      })
    ).body;
    const now = Date.now();
    await ctx.prisma.monitorCheck.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        organizationId: orgId,
        monitorId: monitor.id,
        idempotencyKey: `seed-${i}`,
        result: i < 9 ? ('UP' as const) : ('DOWN' as const),
        statusCode: i < 9 ? 200 : 503,
        latencyMs: 100 + i * 10,
        checkedAt: new Date(now - i * 60_000),
      })),
    });
    await ctx.prisma.monitor.update({ where: { id: monitor.id }, data: { status: 'DOWN' } });
    const detail = await client.get(`${base}/applications/${appId}?range=24h`);
    expect(detail.body.uptime).toBe(90);
    expect(detail.body.status).toBe('DOWN');

    const dash = await client.get(`${base}/dashboard?range=24h`);
    expect(dash.body).toMatchObject({
      uptime: 90,
      checks: 10,
      applications: { total: 1, offline: 1, online: 0 },
    });
    expect(dash.body.avgResponseMs).toBe(140); // DOWN check excluded: avg(100..180)
    expect(dash.body.series.length).toBeGreaterThan(0);

    const rel = await client.get(`${base}/reliability?range=24h`);
    expect(rel.body.monitors[0]).toMatchObject({
      checks: 10,
      uptime: 90,
      successRate: 90,
      failureRate: 10,
    });
    expect(rel.body.monitors[0].latency.p95).toBeGreaterThanOrEqual(170);

    const checks = await client.get(`${base}/monitors/${monitor.id}/checks?limit=4`);
    expect(checks.body.items).toHaveLength(4);
    const next = await client.get(
      `${base}/monitors/${monitor.id}/checks?limit=4&cursor=${checks.body.nextCursor}`,
    );
    expect(next.body.items[0].id).not.toBe(checks.body.items[3].id);
  });

  it('filters the dashboard by application', async () => {
    const { client, base, orgId, projectId } = await setup();
    await createApplication(client, orgId, projectId, 'Other');
    const apps = (await client.get(`${base}/applications`)).body;
    const filtered = await client.get(`${base}/dashboard?applicationId=${apps[1].id}`);
    expect(filtered.body.applications.total).toBe(1);
  });
});

describe('incident management', () => {
  it('runs the lifecycle with validated transitions, assignment, comments and report', async () => {
    const { client, base, appId, userId } = await setup();
    const incident = (
      await client.post(`${base}/incidents`, {
        applicationId: appId,
        title: 'Checkout errors',
        severity: 'CRITICAL',
      })
    ).body;
    expect(incident.status).toBe('OPEN');

    // Critical incidents notify every member
    const notes = await client.get(`${base}/notifications`);
    expect(notes.body.items.map((n: { type: string }) => n.type)).toContain('INCIDENT_CRITICAL');

    expect(
      (
        await client.patch(`${base}/incidents/${incident.id}`, {
          status: 'INVESTIGATING',
          assigneeId: userId,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await client.post(`${base}/incidents/${incident.id}/comments`, {
          message: 'Rolling back release 42',
        })
      ).status,
    ).toBe(201);
    await client.patch(`${base}/incidents/${incident.id}`, {
      probableCause: 'Bad release',
      status: 'IDENTIFIED',
    });
    const resolved = await client.patch(`${base}/incidents/${incident.id}`, {
      status: 'RESOLVED',
      resolutionNote: 'Rolled back',
    });
    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.resolvedAt).not.toBeNull();
    expect(resolved.body.allowedTransitions).toEqual(['OPEN']);

    const invalid = await client.patch(`${base}/incidents/${incident.id}`, {
      status: 'MONITORING',
    });
    expect(invalid.status).toBe(400);

    const types = resolved.body.events.map((e: { type: string }) => e.type);
    expect(types).toEqual([
      'CREATED',
      'STATUS_CHANGED',
      'ASSIGNED',
      'COMMENT',
      'STATUS_CHANGED',
      'CAUSE_UPDATED',
      'STATUS_CHANGED',
    ]);

    const report = await client.get(`${base}/incidents/${incident.id}/report`);
    expect(report.body).toMatchObject({
      probableCause: 'Bad release',
      resolutionNote: 'Rolled back',
      status: 'RESOLVED',
    });
    expect(report.body.timeline.length).toBe(7);
  });

  it('only assigns members of the organisation', async () => {
    const { client, base, appId } = await setup();
    const outsider = await signUp(ctx.app, 'Outsider');
    const incident = (
      await client.post(`${base}/incidents`, {
        applicationId: appId,
        title: 'x happened',
        severity: 'LOW',
      })
    ).body;
    expect(
      (await client.patch(`${base}/incidents/${incident.id}`, { assigneeId: outsider.userId }))
        .status,
    ).toBe(400);
  });

  it('filters active vs resolved incidents and paginates', async () => {
    const { client, base, appId } = await setup();
    for (let i = 0; i < 3; i++)
      await client.post(`${base}/incidents`, {
        applicationId: appId,
        title: `incident ${i}`,
        severity: 'LOW',
      });
    const first = (await client.get(`${base}/incidents?limit=2`)).body;
    await client.patch(`${base}/incidents/${first.items[0].id}`, { status: 'RESOLVED' });
    expect((await client.get(`${base}/incidents?active=true`)).body.items).toHaveLength(2);
    expect((await client.get(`${base}/incidents?active=false`)).body.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
  });
});

describe('log ingestion & search', () => {
  async function withKey() {
    const s = await setup();
    const key = (
      await s.client.post(`${s.base}/applications/${s.appId}/api-keys`, { name: 'prod' })
    ).body.key as string;
    return {
      ...s,
      key,
      ingest: (body: object) =>
        request(ctx.app.getHttpServer())
          .post('/api/v1/ingest/logs')
          .set('X-DevPulse-Key', key)
          .send(body),
    };
  }

  it('authenticates with an application key, redacts secrets and groups errors', async () => {
    const { ingest, client, base, key } = await withKey();
    const res = await ingest({
      logs: [
        {
          severity: 'ERROR',
          message: 'Timeout calling bank after 3000ms (order 17)',
          metadata: { password: 'p', nested: { token: 't' }, ok: 1 },
        },
        { severity: 'ERROR', message: 'Timeout calling bank after 5000ms (order 99)' },
        { severity: 'INFO', message: 'login ok for user 5 with Bearer abc.def.ghi' },
      ],
    });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 3, grouped: 2 });

    const logs = (await client.get(`${base}/logs`)).body.items;
    expect(JSON.stringify(logs)).not.toMatch(/"p"|"t"|abc\.def\.ghi/);
    expect(logs.find((l: { metadata: unknown }) => l.metadata)?.metadata).toEqual({
      password: '[REDACTED]',
      nested: { token: '[REDACTED]' },
      ok: 1,
    });

    const groups = (await client.get(`${base}/error-groups`)).body;
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);

    const stored = await ctx.prisma.apiKey.findFirstOrThrow();
    expect(stored.keyHash).not.toBe(key);
    expect(stored.lastUsedAt).not.toBeNull();
  });

  it('keeps group counts correct under concurrent batches', async () => {
    const { ingest, client, base } = await withKey();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        ingest({
          logs: Array.from({ length: 10 }, () => ({
            severity: 'ERROR',
            message: 'DB connection reset',
          })),
        }),
      ),
    );
    expect((await client.get(`${base}/error-groups`)).body[0].count).toBe(50);
  });

  it('rejects missing, invalid, revoked keys and oversized batches', async () => {
    const { ingest, client, base, appId } = await withKey();
    const server = ctx.app.getHttpServer();
    expect(
      (
        await request(server)
          .post('/api/v1/ingest/logs')
          .send({ logs: [{ severity: 'INFO', message: 'x' }] })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(server)
          .post('/api/v1/ingest/logs')
          .set('X-DevPulse-Key', 'dp_AAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')
          .send({ logs: [{ severity: 'INFO', message: 'x' }] })
      ).status,
    ).toBe(401);
    expect(
      (
        await ingest({
          logs: Array.from({ length: 101 }, () => ({ severity: 'INFO', message: 'x' })),
        })
      ).status,
    ).toBe(400);
    expect((await ingest({ logs: [{ severity: 'INFO', message: 'x'.repeat(9000) }] })).status).toBe(
      400,
    );

    const keyId = (await client.get(`${base}/applications/${appId}/api-keys`)).body[0].id;
    expect((await client.delete(`${base}/applications/${appId}/api-keys/${keyId}`)).status).toBe(
      204,
    );
    expect((await ingest({ logs: [{ severity: 'INFO', message: 'x' }] })).status).toBe(401);
  });

  it('searches literally (LIKE wildcards escaped), filters and paginates', async () => {
    const { ingest, client, base } = await withKey();
    await ingest({
      logs: [
        { severity: 'INFO', message: '100% complete' },
        { severity: 'WARN', message: 'disk at 90 percent' },
        { severity: 'INFO', message: 'snake_case_value' },
      ],
    });
    expect((await client.get(`${base}/logs?q=100%25`)).body.items).toHaveLength(1);
    expect((await client.get(`${base}/logs?q=%25`)).body.items).toHaveLength(1);
    expect((await client.get(`${base}/logs?q=e_c`)).body.items).toHaveLength(1);
    expect((await client.get(`${base}/logs?severity=WARN`)).body.items).toHaveLength(1);
    const page = (await client.get(`${base}/logs?limit=2`)).body;
    expect(page.items).toHaveLength(2);
    expect(
      (await client.get(`${base}/logs?limit=2&cursor=${page.nextCursor}`)).body.items,
    ).toHaveLength(1);
  });
});

describe('AI analysis requests', () => {
  it('records NOT_CONFIGURED without an API key and never claims an analysis', async () => {
    const { client, base, appId } = await setup();
    const incident = (
      await client.post(`${base}/incidents`, {
        applicationId: appId,
        title: 'x happened',
        severity: 'LOW',
      })
    ).body;
    expect((await client.get(`${base}/ai/status`)).body.configured).toBe(false);
    const res = await client.post(`${base}/ai/analyses`, {
      targetType: 'INCIDENT',
      targetId: incident.id,
    });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'NOT_CONFIGURED', result: null, summary: null });
  });

  it('queues a PENDING analysis when configured, dedupes in-flight requests and enforces the budget', async () => {
    const configured = await startApp({ ANTHROPIC_API_KEY: 'sk-ant-test-not-real' });
    try {
      const user = await signUp(configured.app);
      const base = `/orgs/${user.orgId}`;
      const appId = await createApplication(user.client, user.orgId, user.projectId);
      const incident = (
        await user.client.post(`${base}/incidents`, {
          applicationId: appId,
          title: 'x happened',
          severity: 'LOW',
        })
      ).body;
      const first = await user.client.post(`${base}/ai/analyses`, {
        targetType: 'INCIDENT',
        targetId: incident.id,
      });
      const second = await user.client.post(`${base}/ai/analyses`, {
        targetType: 'INCIDENT',
        targetId: incident.id,
      });
      expect(first.body.status).toBe('PENDING');
      expect(second.body.id).toBe(first.body.id);

      await ctx.prisma.aIAnalysis.update({
        where: { id: first.body.id },
        data: { status: 'FAILED' },
      });
      await ctx.prisma.usageRecord.create({
        data: {
          organizationId: user.orgId,
          provider: 'anthropic',
          model: 'claude-opus-5-5',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 10,
        },
      });
      const blocked = await user.client.post(`${base}/ai/analyses`, {
        targetType: 'INCIDENT',
        targetId: incident.id,
      });
      expect(blocked.body.status).toBe('BUDGET_EXCEEDED');
    } finally {
      await configured.close();
    }
  });
});
