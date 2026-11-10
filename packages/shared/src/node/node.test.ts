import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertUrlShape,
  BlockedDestinationError,
  generateApiKey,
  isBlockedAddress,
  logFingerprint,
  parseApiKey,
  resolveAndValidate,
  safeHttpRequest,
} from './index.js';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'])('allows public %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe('assertUrlShape', () => {
  it.each([
    'http://localhost:8080',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://foo.localhost/',
    'gopher://example.com',
    'https://user:pw@example.com',
    'http://0x7f000001/',
    'http://2130706433/',
  ])('rejects %s', (url) => {
    expect(() => assertUrlShape(url)).toThrow(BlockedDestinationError);
  });

  it('accepts public URLs and explicitly allow-listed hosts', () => {
    expect(assertUrlShape('https://example.com/health').hostname).toBe('example.com');
    expect(assertUrlShape('http://127.0.0.1:4010/', { allowlist: ['127.0.0.1'] }).port).toBe(
      '4010',
    );
  });
});

describe('resolveAndValidate (DNS)', () => {
  const fakeLookup = (map: Record<string, string[]>) =>
    ((
      host: string,
      _opts: unknown,
      cb: (e: Error | null, a: { address: string; family: number }[]) => void,
    ) =>
      cb(
        null,
        (map[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
      )) as never;

  it('rejects hostnames resolving to private addresses (DNS rebinding style)', async () => {
    await expect(
      resolveAndValidate(
        'evil.example',
        {},
        fakeLookup({ 'evil.example': ['93.184.216.34', '10.0.0.5'] }),
      ),
    ).rejects.toThrow(BlockedDestinationError);
  });

  it('accepts hostnames resolving only to public addresses', async () => {
    const addrs = await resolveAndValidate(
      'ok.example',
      {},
      fakeLookup({ 'ok.example': ['93.184.216.34'] }),
    );
    expect(addrs).toHaveLength(1);
  });
});

describe('safeHttpRequest', () => {
  let server: Server;
  let base: string;
  const policy = { allowlist: ['127.0.0.1'] };

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/ok') return res.writeHead(200).end('ok');
      if (req.url === '/fail') return res.writeHead(503).end();
      if (req.url === '/slow') return void setTimeout(() => res.writeHead(200).end(), 1500);
      if (req.url === '/redirect-internal')
        return res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
      if (req.url === '/redirect-ok') return res.writeHead(301, { location: '/ok' }).end();
      if (req.url === '/loop') return res.writeHead(302, { location: '/loop' }).end();
      if (req.url === '/big') {
        res.writeHead(200);
        res.end(Buffer.alloc(2 * 1024 * 1024));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('reports status and latency', async () => {
    const out = await safeHttpRequest({
      url: `${base}/ok`,
      method: 'GET',
      timeoutMs: 2000,
      policy,
    });
    expect(out.statusCode).toBe(200);
    expect(out.errorType).toBeNull();
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports non-2xx codes without throwing', async () => {
    expect(
      (await safeHttpRequest({ url: `${base}/fail`, method: 'GET', timeoutMs: 2000, policy }))
        .statusCode,
    ).toBe(503);
  });

  it('times out', async () => {
    const out = await safeHttpRequest({
      url: `${base}/slow`,
      method: 'GET',
      timeoutMs: 300,
      policy,
    });
    expect(out.errorType).toBe('TIMEOUT');
    expect(out.statusCode).toBeNull();
  });

  it('blocks loopback targets when not allow-listed', async () => {
    const out = await safeHttpRequest({ url: `${base}/ok`, method: 'GET', timeoutMs: 2000 });
    expect(out.errorType).toBe('BLOCKED_DESTINATION');
  });

  it('re-validates every redirect hop', async () => {
    const out = await safeHttpRequest({
      url: `${base}/redirect-internal`,
      method: 'GET',
      timeoutMs: 2000,
      policy,
    });
    expect(out.errorType).toBe('BLOCKED_DESTINATION');
    const ok = await safeHttpRequest({
      url: `${base}/redirect-ok`,
      method: 'GET',
      timeoutMs: 2000,
      policy,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.finalUrl).toBe(`${base}/ok`);
  });

  it('caps redirect chains', async () => {
    const out = await safeHttpRequest({
      url: `${base}/loop`,
      method: 'GET',
      timeoutMs: 2000,
      policy,
      maxRedirects: 3,
    });
    expect(out.errorType).toBe('TOO_MANY_REDIRECTS');
  });

  it('does not buffer large bodies', async () => {
    const out = await safeHttpRequest({
      url: `${base}/big`,
      method: 'GET',
      timeoutMs: 2000,
      policy,
      maxBodyBytes: 1024,
    });
    expect(out.statusCode).toBe(200);
  });

  it('classifies refused connections', async () => {
    const out = await safeHttpRequest({
      url: 'http://127.0.0.1:1/',
      method: 'GET',
      timeoutMs: 2000,
      policy,
    });
    expect(out.errorType).toBe('CONNECTION');
  });
});

describe('API keys and fingerprints', () => {
  it('generates parseable keys whose hash is stable', () => {
    const { key, prefix, hash } = generateApiKey();
    expect(parseApiKey(key)).toEqual({ prefix });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parseApiKey('dp_short_x')).toBeNull();
  });

  it('fingerprints by message shape', () => {
    expect(logFingerprint('Timeout after 3000ms on order 77')).toBe(
      logFingerprint('Timeout after 5000ms on order 12'),
    );
    expect(logFingerprint('Timeout')).not.toBe(logFingerprint('Unauthorized'));
  });
});
