import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  applyCheck,
  canManageRole,
  canTransition,
  classifyOutcome,
  extractErrorType,
  flapRate,
  hasPermission,
  isUnstable,
  latencyStats,
  mttrMs,
  normalizeLogMessage,
  percentile,
  REDACTED,
  redactText,
  redactValue,
  severityForOutage,
  uptimeFromCounts,
  uptimePercent,
  type MonitorState,
} from './index.js';

describe('reliability metrics', () => {
  it('returns null uptime without data instead of reporting 100%', () => {
    expect(uptimePercent([])).toBeNull();
    expect(uptimeFromCounts(0, 0)).toBeNull();
  });

  it('counts DEGRADED as available and DOWN as unavailable', () => {
    expect(
      uptimePercent([
        { result: 'UP' },
        { result: 'DEGRADED' },
        { result: 'DOWN' },
        { result: 'UP' },
      ]),
    ).toBe(75);
    expect(uptimeFromCounts(1000, 1)).toBe(99.9);
  });

  it('computes nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
    expect(percentile([42], 99)).toBe(42);
    expect(percentile([], 50)).toBeNull();
    expect(() => percentile([1], 101)).toThrow(RangeError);
  });

  it('excludes failed checks from latency statistics', () => {
    const stats = latencyStats([
      { result: 'UP', latencyMs: 100 },
      { result: 'UP', latencyMs: 300 },
      { result: 'DOWN', latencyMs: 9000 },
    ]);
    expect(stats.avg).toBe(200);
    expect(stats.p99).toBe(300);
  });

  it('measures flapping as share of availability flips', () => {
    expect(
      flapRate([{ result: 'UP' }, { result: 'DOWN' }, { result: 'UP' }, { result: 'DOWN' }]),
    ).toBe(1);
    expect(flapRate([{ result: 'UP' }, { result: 'DEGRADED' }, { result: 'UP' }])).toBe(0);
    expect(flapRate([{ result: 'UP' }])).toBe(0);
  });

  it('flags unstable endpoints with explicit reasons', () => {
    expect(
      isUnstable({ uptime: 100, flapRate: 0, p95LatencyMs: 100, latencyThresholdMs: 500 }).unstable,
    ).toBe(false);
    const result = isUnstable({
      uptime: 97.5,
      flapRate: 0.2,
      p95LatencyMs: 900,
      latencyThresholdMs: 500,
    });
    expect(result.unstable).toBe(true);
    expect(result.reasons).toHaveLength(3);
  });
});

describe('check classification', () => {
  const expect2xx = { expectedStatusCodes: [], latencyThresholdMs: null };

  it('accepts any 2xx by default and rejects others', () => {
    expect(
      classifyOutcome(
        { statusCode: 204, latencyMs: 10, errorType: null, errorMessage: null },
        expect2xx,
      ).result,
    ).toBe('UP');
    const down = classifyOutcome(
      { statusCode: 503, latencyMs: 10, errorType: null, errorMessage: null },
      expect2xx,
    );
    expect(down).toMatchObject({ result: 'DOWN', errorType: 'STATUS_CODE' });
  });

  it('honours explicit expected codes', () => {
    const cfg = { expectedStatusCodes: [301, 401], latencyThresholdMs: null };
    expect(
      classifyOutcome({ statusCode: 401, latencyMs: 5, errorType: null, errorMessage: null }, cfg)
        .result,
    ).toBe('UP');
    expect(
      classifyOutcome({ statusCode: 200, latencyMs: 5, errorType: null, errorMessage: null }, cfg)
        .result,
    ).toBe('DOWN');
  });

  it('marks slow but successful responses as DEGRADED', () => {
    const out = classifyOutcome(
      { statusCode: 200, latencyMs: 900, errorType: null, errorMessage: null },
      { expectedStatusCodes: [], latencyThresholdMs: 500 },
    );
    expect(out.result).toBe('DEGRADED');
  });

  it('treats transport errors as DOWN and keeps their type', () => {
    const out = classifyOutcome(
      { statusCode: null, latencyMs: null, errorType: 'TIMEOUT', errorMessage: 'slow' },
      expect2xx,
    );
    expect(out).toEqual({ result: 'DOWN', errorType: 'TIMEOUT', errorMessage: 'slow' });
  });
});

describe('monitor state machine', () => {
  const base: MonitorState = {
    status: 'UP',
    consecutiveFailures: 0,
    failureThreshold: 3,
    hasOpenIncident: false,
  };

  it('does not go DOWN or open incidents before the threshold', () => {
    const t1 = applyCheck(base, 'DOWN');
    expect(t1).toMatchObject({
      status: 'UP',
      consecutiveFailures: 1,
      action: { type: 'NONE' },
      statusChanged: false,
    });
    const t2 = applyCheck({ ...base, consecutiveFailures: 1 }, 'DOWN');
    expect(t2.action.type).toBe('NONE');
  });

  it('opens exactly one incident when the threshold is reached', () => {
    const t = applyCheck({ ...base, consecutiveFailures: 2 }, 'DOWN');
    expect(t).toMatchObject({
      status: 'DOWN',
      consecutiveFailures: 3,
      action: { type: 'OPEN_INCIDENT' },
      statusChanged: true,
    });
    const next = applyCheck(
      { ...base, status: 'DOWN', consecutiveFailures: 3, hasOpenIncident: true },
      'DOWN',
    );
    expect(next.action.type).toBe('APPEND_FAILURE');
    expect(next.statusChanged).toBe(false);
  });

  it('resolves the open incident on recovery and resets the counter', () => {
    const t = applyCheck(
      { ...base, status: 'DOWN', consecutiveFailures: 5, hasOpenIncident: true },
      'UP',
    );
    expect(t).toMatchObject({
      status: 'UP',
      consecutiveFailures: 0,
      action: { type: 'RESOLVE_INCIDENT' },
      statusChanged: true,
    });
  });

  it('signals a latency breach only on the transition into DEGRADED', () => {
    expect(applyCheck(base, 'DEGRADED').latencyBreached).toBe(true);
    expect(applyCheck({ ...base, status: 'DEGRADED' }, 'DEGRADED').latencyBreached).toBe(false);
  });

  it('opens immediately with threshold 1', () => {
    expect(
      applyCheck({ ...base, failureThreshold: 1, status: 'PENDING' }, 'DOWN').action.type,
    ).toBe('OPEN_INCIDENT');
  });

  it('derives outage severity from the environment', () => {
    expect(severityForOutage('PRODUCTION')).toBe('CRITICAL');
    expect(severityForOutage('STAGING')).toBe('MEDIUM');
    expect(severityForOutage('DEVELOPMENT')).toBe('LOW');
  });
});

describe('incident workflow', () => {
  it('allows the documented lifecycle', () => {
    expect(canTransition('OPEN', 'INVESTIGATING')).toBe(true);
    expect(canTransition('MONITORING', 'INVESTIGATING')).toBe(true);
    expect(canTransition('RESOLVED', 'OPEN')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('RESOLVED', 'MONITORING')).toBe(false);
    expect(canTransition('OPEN', 'OPEN')).toBe(false);
    expect(allowedTransitions('RESOLVED')).toEqual(['OPEN']);
  });

  it('computes MTTR over resolved incidents only', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    expect(
      mttrMs([
        { openedAt: t0, resolvedAt: new Date(t0.getTime() + 60_000) },
        { openedAt: t0, resolvedAt: new Date(t0.getTime() + 180_000) },
        { openedAt: t0, resolvedAt: null },
      ]),
    ).toBe(120_000);
    expect(mttrMs([{ openedAt: t0, resolvedAt: null }])).toBeNull();
  });
});

describe('RBAC', () => {
  it('grants permissions cumulatively by role', () => {
    expect(hasPermission('VIEWER', 'org:read')).toBe(true);
    expect(hasPermission('VIEWER', 'monitors:write')).toBe(false);
    expect(hasPermission('MEMBER', 'ai:analyze')).toBe(true);
    expect(hasPermission('MEMBER', 'members:manage')).toBe(false);
    expect(hasPermission('ADMIN', 'apikeys:manage')).toBe(true);
    expect(hasPermission('ADMIN', 'org:delete')).toBe(false);
    expect(hasPermission('OWNER', 'org:delete')).toBe(true);
  });

  it('prevents privilege escalation when managing members', () => {
    expect(canManageRole('ADMIN', 'MEMBER')).toBe(true);
    expect(canManageRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canManageRole('ADMIN', 'OWNER')).toBe(false);
    expect(canManageRole('MEMBER', 'VIEWER')).toBe(false);
    expect(canManageRole('OWNER', 'OWNER')).toBe(true);
  });
});

describe('redaction', () => {
  it.each([
    ['Authorization: Bearer abc.def-ghi_123', 'abc.def-ghi_123'],
    ['key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA used', 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijk', 'eyJhbGciOiJIUzI1NiJ9'],
    ['connect postgres://admin:hunter2@db:5432/x', 'hunter2'],
    ['login failed password=SuperSecret1 for user', 'SuperSecret1'],
    ['aws AKIAIOSFODNN7EXAMPLE leaked', 'AKIAIOSFODNN7EXAMPLE'],
    ['card 4111 1111 1111 1111 charged', '4111 1111 1111 1111'],
  ])('removes secrets from %s', (input, secret) => {
    const out = redactText(input);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it('keeps non-secret numbers that fail the Luhn check', () => {
    expect(redactText('order 1234567890123 shipped')).toBe('order 1234567890123 shipped');
  });

  it('masks sensitive keys recursively and bounds size', () => {
    const out = redactValue({
      user: 'ana',
      password: 'x',
      nested: { apiKey: 'y', headers: { Cookie: 'sid=1', accept: 'json' } },
      list: Array.from({ length: 100 }, (_, i) => i),
    }) as Record<string, unknown>;
    expect(out.password).toBe(REDACTED);
    expect(out.nested).toEqual({ apiKey: REDACTED, headers: { Cookie: REDACTED, accept: 'json' } });
    expect((out.list as unknown[]).length).toBe(50);
  });

  it('truncates deep structures', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(JSON.stringify(redactValue(deep))).toContain('[TRUNCATED_DEPTH]');
  });
});

describe('log normalisation', () => {
  it('groups messages that differ only in variable parts', () => {
    const a = normalizeLogMessage(
      'User 123 failed to load order 9f1c2b3a-1111-2222-3333-444455556666 at 2026-01-01T10:00:00Z',
    );
    const b = normalizeLogMessage(
      'User 98 failed to load order 0a0a0a0a-aaaa-bbbb-cccc-ddddeeeeffff at 2026-03-02T11:22:33Z',
    );
    expect(a).toBe(b);
  });

  it('ignores stack traces when grouping', () => {
    expect(normalizeLogMessage('TypeError: x is undefined\n at foo (a.js:1:2)')).toBe(
      normalizeLogMessage('TypeError: x is undefined\n at bar (b.js:9:9)'),
    );
  });

  it('extracts error types', () => {
    expect(extractErrorType('TypeError: Cannot read properties of undefined')).toBe('TypeError');
    expect(extractErrorType('connect ECONNREFUSED 10.0.0.1:5432')).toBe('ECONNREFUSED');
    expect(extractErrorType('upstream returned HTTP 502')).toBe('HTTP 502');
    expect(extractErrorType('all good')).toBeNull();
  });
});
