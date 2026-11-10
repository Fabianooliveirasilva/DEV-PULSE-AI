// Thin typed fetch wrapper. All calls go to the same origin (/api/v1 is proxied to the
// API by next.config.ts), so the httpOnly session cookie is sent automatically.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | string[] | null | undefined>;

function buildUrl(path: string, query?: Query) {
  const url = new URL(
    `/api/v1${path}`,
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  );
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
    else url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const res = await fetch(buildUrl(path, query), {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as {
    message?: string;
    details?: { path: string; message: string }[];
  } | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.message ?? `Request failed (${res.status})`,
      data?.details,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
};

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.details?.length)
      return error.details.map((d) => `${d.path ? `${d.path}: ` : ''}${d.message}`).join(' · ');
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
