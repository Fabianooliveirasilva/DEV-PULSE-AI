import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { DATABASE_URL: 'postgresql://x', QUEUE_BACKEND: 'postgres' };

describe('worker configuration', () => {
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      WORKER_CONCURRENCY: 10,
      ANTHROPIC_MODEL: 'claude-opus-5-5',
      AI_TIMEOUT_MS: 60_000,
      SSRF_ALLOWLIST: [],
    });
  });

  it('requires REDIS_URL for the redis backend', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://x', QUEUE_BACKEND: 'redis' })).toThrow(
      /REDIS_URL/,
    );
  });

  it('refuses an SSRF allowlist in production', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', SSRF_ALLOWLIST: '127.0.0.1' }),
    ).toThrow(/SSRF_ALLOWLIST/);
    expect(
      loadConfig({ ...base, NODE_ENV: 'test', SSRF_ALLOWLIST: '127.0.0.1, localhost' })
        .SSRF_ALLOWLIST,
    ).toEqual(['127.0.0.1', 'localhost']);
  });

  it('bounds concurrency', () => {
    expect(() => loadConfig({ ...base, WORKER_CONCURRENCY: '0' })).toThrow();
    expect(() => loadConfig({ ...base, WORKER_CONCURRENCY: '1000' })).toThrow();
  });
});
