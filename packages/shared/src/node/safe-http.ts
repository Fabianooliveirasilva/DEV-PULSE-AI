import http from 'node:http';
import https from 'node:https';
import type { CheckErrorType } from '../enums.js';
import type { HttpOutcome } from '../monitor-rules.js';
import {
  assertUrlShape,
  BlockedDestinationError,
  createGuardedLookup,
  type SsrfPolicy,
} from './ssrf.js';

export interface SafeRequestOptions {
  url: string;
  method: 'GET' | 'HEAD' | 'POST';
  timeoutMs: number;
  headers?: Record<string, string>;
  body?: string;
  maxRedirects?: number;
  /** Bytes of response body read before the socket is dropped. */
  maxBodyBytes?: number;
  policy?: SsrfPolicy;
  userAgent?: string;
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

interface SingleResponse {
  statusCode: number;
  location: string | undefined;
}

function requestOnce(
  url: URL,
  opts: SafeRequestOptions,
  signal: AbortSignal,
): Promise<SingleResponse> {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: opts.method,
        signal,
        lookup: createGuardedLookup(opts.policy) as never,
        headers: {
          'user-agent': opts.userAgent ?? 'DevPulseAI-Monitor/1.0',
          accept: '*/*',
          ...(opts.body ? { 'content-length': Buffer.byteLength(opts.body).toString() } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        let read = 0;
        const max = opts.maxBodyBytes ?? 64 * 1024;
        res.on('data', (chunk: Buffer) => {
          read += chunk.length;
          if (read > max) res.destroy(); // we only need the status; never buffer large bodies
        });
        const done = () =>
          resolve({ statusCode: res.statusCode ?? 0, location: res.headers.location });
        res.on('end', done);
        res.on('close', done);
        res.on('error', done);
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export function classifyNetworkError(error: unknown): {
  errorType: CheckErrorType;
  message: string;
} {
  if (error instanceof BlockedDestinationError) {
    return { errorType: 'BLOCKED_DESTINATION', message: error.message };
  }
  const err = error as NodeJS.ErrnoException & { name?: string };
  const code = err?.code ?? '';
  if (
    err?.name === 'AbortError' ||
    err?.name === 'TimeoutError' ||
    code === 'ETIMEDOUT' ||
    code === 'ABORT_ERR'
  ) {
    return { errorType: 'TIMEOUT', message: 'Request timed out' };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
    return { errorType: 'DNS', message: `DNS resolution failed (${code})` };
  }
  if (code.startsWith('ERR_TLS') || code.includes('CERT') || code === 'EPROTO') {
    return { errorType: 'TLS', message: `TLS error (${code})` };
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].includes(code)) {
    return { errorType: 'CONNECTION', message: `Connection failed (${code})` };
  }
  return { errorType: 'UNKNOWN', message: (err?.message ?? 'Unknown error').slice(0, 300) };
}

/**
 * Performs an HTTP request with SSRF protection on every hop:
 * scheme/host checks, DNS re-validation at connect time and bounded manual redirects.
 * Never throws: failures are reported in the outcome.
 */
export async function safeHttpRequest(
  opts: SafeRequestOptions,
): Promise<HttpOutcome & { finalUrl: string }> {
  const started = performance.now();
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = opts.url;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const url = assertUrlShape(current, opts.policy);
      const res = await requestOnce(
        url,
        hop === 0 ? opts : { ...opts, method: 'GET', body: undefined },
        signal,
      );
      if (REDIRECT_CODES.has(res.statusCode) && res.location) {
        current = new URL(res.location, url).toString();
        continue;
      }
      return {
        statusCode: res.statusCode,
        latencyMs: Math.round(performance.now() - started),
        errorType: null,
        errorMessage: null,
        finalUrl: current,
      };
    }
    return {
      statusCode: null,
      latencyMs: Math.round(performance.now() - started),
      errorType: 'TOO_MANY_REDIRECTS',
      errorMessage: `More than ${maxRedirects} redirects`,
      finalUrl: current,
    };
  } catch (error) {
    const { errorType, message } = signal.aborted
      ? { errorType: 'TIMEOUT' as const, message: `No response within ${opts.timeoutMs}ms` }
      : classifyNetworkError(error);
    return {
      statusCode: null,
      latencyMs: errorType === 'TIMEOUT' ? null : Math.round(performance.now() - started),
      errorType,
      errorMessage: message,
      finalUrl: current,
    };
  }
}
