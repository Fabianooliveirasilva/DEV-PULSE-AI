import type { NextRequest } from 'next/server';

// Same-origin proxy to the API. Resolved at request time (unlike next.config rewrites,
// which are frozen at build time), so one image works in every environment.
// The browser never talks to the API directly: cookies stay first-party and CORS is unused.

export const dynamic = 'force-dynamic';

const FORWARDED_REQUEST_HEADERS = [
  'cookie',
  'content-type',
  'origin',
  'referer',
  'user-agent',
  'x-request-id',
  'x-devpulse-key',
  'authorization',
  'accept',
];
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'content-encoding',
  'content-length',
]);

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const base = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  const target = new URL(
    `/api/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`,
    base,
  );

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // The API trusts exactly one proxy hop (TRUST_PROXY=1) to read the client IP for rate limits.
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (clientIp) headers.set('x-forwarded-for', clientIp);

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      {
        statusCode: 502,
        error: 'BAD_GATEWAY',
        message: 'The API is unreachable. Please try again shortly.',
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key) && key !== 'set-cookie') responseHeaders.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie())
    responseHeaders.append('set-cookie', cookie);
  return new Response(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export { proxy as DELETE, proxy as GET, proxy as PATCH, proxy as POST, proxy as PUT };
