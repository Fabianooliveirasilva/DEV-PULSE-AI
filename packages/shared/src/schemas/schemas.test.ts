import { describe, expect, it } from 'vitest';
import {
  createChannelSchema,
  createMonitorSchema,
  incidentQuerySchema,
  ingestBatchSchema,
  ingestLogSchema,
  logQuerySchema,
  registerSchema,
  updateIncidentSchema,
} from './index.js';

const appId = '0190f6a0-0000-7000-8000-000000000001';

describe('registerSchema', () => {
  it('normalises e-mail and enforces password length', () => {
    const ok = registerSchema.parse({
      name: ' Ana ',
      email: ' Ana@Example.COM ',
      password: 'correct horse battery',
      organizationName: 'Acme',
    });
    expect(ok.email).toBe('ana@example.com');
    expect(ok.name).toBe('Ana');
    expect(registerSchema.safeParse({ ...ok, password: 'short' }).success).toBe(false);
  });
});

describe('createMonitorSchema', () => {
  const valid = { applicationId: appId, name: 'API', url: 'https://example.com/health' };

  it('applies safe defaults', () => {
    expect(createMonitorSchema.parse(valid)).toMatchObject({
      method: 'GET',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      failureThreshold: 3,
      expectedStatusCodes: [],
    });
  });

  it.each([
    'ftp://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pass@example.com',
    'not a url',
  ])('rejects %s', (url) => {
    expect(createMonitorSchema.safeParse({ ...valid, url }).success).toBe(false);
  });

  it('rejects intervals below 30s and timeouts longer than the interval', () => {
    expect(createMonitorSchema.safeParse({ ...valid, intervalSeconds: 5 }).success).toBe(false);
    const r = createMonitorSchema.safeParse({ ...valid, intervalSeconds: 30, timeoutMs: 30_000 });
    expect(r.success).toBe(false);
  });
});

describe('log ingestion schemas', () => {
  it('accepts a well-formed event', () => {
    expect(ingestLogSchema.parse({ severity: 'ERROR', message: 'boom' }).environment).toBe(
      'production',
    );
  });

  it('rejects oversized messages, metadata and batches', () => {
    expect(
      ingestLogSchema.safeParse({ severity: 'ERROR', message: 'x'.repeat(8193) }).success,
    ).toBe(false);
    expect(
      ingestLogSchema.safeParse({
        severity: 'ERROR',
        message: 'x',
        metadata: { blob: 'y'.repeat(9000) },
      }).success,
    ).toBe(false);
    const logs = Array.from({ length: 101 }, () => ({ severity: 'INFO', message: 'x' }));
    expect(ingestBatchSchema.safeParse({ logs }).success).toBe(false);
  });

  it('rejects unknown severities and malformed environments', () => {
    expect(ingestLogSchema.safeParse({ severity: 'PANIC', message: 'x' }).success).toBe(false);
    expect(
      ingestLogSchema.safeParse({ severity: 'INFO', message: 'x', environment: 'prod; drop' })
        .success,
    ).toBe(false);
  });

  it('accepts single or repeated severity filters', () => {
    expect(logQuerySchema.parse({ severity: 'ERROR' }).severity).toEqual(['ERROR']);
    expect(logQuerySchema.parse({ severity: ['ERROR', 'FATAL'] }).severity).toEqual([
      'ERROR',
      'FATAL',
    ]);
    expect(logQuerySchema.parse({}).limit).toBe(50);
    expect(logQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });
});

describe('query booleans', () => {
  it('parses "false" as false (unlike z.coerce.boolean)', () => {
    expect(incidentQuerySchema.parse({ active: 'false' }).active).toBe(false);
    expect(incidentQuerySchema.parse({ active: 'true' }).active).toBe(true);
    expect(incidentQuerySchema.safeParse({ active: 'yes' }).success).toBe(false);
  });
});

describe('updateIncidentSchema', () => {
  it('requires at least one field', () => {
    expect(updateIncidentSchema.safeParse({}).success).toBe(false);
    expect(updateIncidentSchema.safeParse({ status: 'RESOLVED' }).success).toBe(true);
  });
});

describe('createChannelSchema', () => {
  it('validates the target according to the channel type', () => {
    expect(
      createChannelSchema.safeParse({
        type: 'EMAIL',
        name: 'ops',
        target: 'ops@example.com',
        events: ['MONITOR_DOWN'],
      }).success,
    ).toBe(true);
    expect(
      createChannelSchema.safeParse({
        type: 'EMAIL',
        name: 'ops',
        target: 'https://x.io',
        events: ['MONITOR_DOWN'],
      }).success,
    ).toBe(false);
    expect(
      createChannelSchema.safeParse({
        type: 'WEBHOOK',
        name: 'hook',
        target: 'https://hooks.example.com/x',
        events: ['MONITOR_DOWN'],
      }).success,
    ).toBe(true);
  });
});
