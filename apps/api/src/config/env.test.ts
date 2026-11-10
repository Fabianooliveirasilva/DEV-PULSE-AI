import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://x',
  QUEUE_BACKEND: 'postgres',
  WEB_ORIGINS: 'http://localhost:3000',
  WEB_PUBLIC_URL: 'http://localhost:3000',
};

describe('API environment validation', () => {
  it('parses lists and derives secure cookies in production', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      WEB_ORIGINS: 'https://a.example, https://b.example',
    });
    expect(env.WEB_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
    expect(env.cookieSecure).toBe(true);
    expect(loadEnv(base).cookieSecure).toBe(false);
  });

  it.each([
    ['SSRF_ALLOWLIST', '127.0.0.1'],
    ['MAIL_OUTBOX_DIR', '/tmp/out'],
    ['RATE_LIMIT_DISABLED', 'true'],
  ])('rejects %s in production', (key, value) => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', [key]: value })).toThrow(key);
  });

  it('requires at least one valid web origin and REDIS_URL for redis', () => {
    expect(() => loadEnv({ ...base, WEB_ORIGINS: '' })).toThrow(/WEB_ORIGINS/);
    expect(() => loadEnv({ ...base, WEB_ORIGINS: 'not a url' })).toThrow(/WEB_ORIGINS/);
    expect(() => loadEnv({ ...base, QUEUE_BACKEND: 'redis' })).toThrow(/REDIS_URL/);
  });

  it('rejects short metrics tokens', () => {
    expect(() => loadEnv({ ...base, METRICS_TOKEN: 'short' })).toThrow(/METRICS_TOKEN/);
  });
});
