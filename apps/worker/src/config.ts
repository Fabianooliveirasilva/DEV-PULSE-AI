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

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    QUEUE_BACKEND: z.enum(['redis', 'postgres']).default('redis'),
    REDIS_URL: z.string().optional(),
    SSRF_ALLOWLIST: list,
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(60_000),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(10),
    WORKER_METRICS_PORT: z.coerce.number().int().default(9464),
    METRICS_TOKEN: z.string().min(16).optional(),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('DevPulse AI <no-reply@devpulse.local>'),
    MAIL_OUTBOX_DIR: z.string().optional(),
    WEB_PUBLIC_URL: z.url().default('http://localhost:3000'),
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
    if (env.NODE_ENV === 'production' && env.SSRF_ALLOWLIST.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['SSRF_ALLOWLIST'],
        message: 'must be empty in production',
      });
    }
  });

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid worker configuration:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}
