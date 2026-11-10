import { z } from 'zod';

const list = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z.string().min(1),
    QUEUE_BACKEND: z.enum(['redis', 'postgres']).default('redis'),
    REDIS_URL: z.string().optional(),
    /** Comma-separated browser origins allowed for CORS and CSRF origin checks. */
    WEB_ORIGINS: list.pipe(z.array(z.url()).min(1)),
    /** Public URL of the web app, used in e-mails (password reset links). */
    WEB_PUBLIC_URL: z.url(),
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(24 * 7),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('DevPulse AI <no-reply@devpulse.local>'),
    /** Dev/test only: write e-mails as JSON files instead of sending them. */
    MAIL_OUTBOX_DIR: z.string().optional(),
    /** Dev/test only: hosts monitors may reach even though they are private. */
    SSRF_ALLOWLIST: list,
    /** Bearer token required to scrape /metrics. Unset = metrics disabled. */
    METRICS_TOKEN: z.string().min(16).optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    RATE_LIMIT_DISABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.QUEUE_BACKEND === 'redis' && !env.REDIS_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'required when QUEUE_BACKEND=redis',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (env.SSRF_ALLOWLIST.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['SSRF_ALLOWLIST'],
          message: 'must be empty in production',
        });
      }
      if (env.MAIL_OUTBOX_DIR) {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_OUTBOX_DIR'],
          message: 'not allowed in production',
        });
      }
      if (env.RATE_LIMIT_DISABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['RATE_LIMIT_DISABLED'],
          message: 'not allowed in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema> & { cookieSecure: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  return { ...env, cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production' };
}

export const ENV = Symbol('ENV');
