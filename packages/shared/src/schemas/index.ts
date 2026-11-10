import { z } from 'zod';
import {
  AI_ANALYSIS_TARGETS,
  APP_ENVIRONMENTS,
  CHANNEL_TYPES,
  HTTP_METHODS,
  INCIDENT_STATUSES,
  LOG_SEVERITIES,
  NOTIFICATION_TYPES,
  ORG_ROLES,
  SEVERITIES,
} from '../enums.js';

// ───────── primitives ─────────

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
export const idSchema = z.uuid();
/** Query-string boolean: only the literals "true"/"false" (z.coerce.boolean treats "false" as true). */
export const queryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** NIST 800-63B style: length over composition rules. */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters');

/** Syntactic URL policy. Network-level SSRF checks run server-side (see shared/node/ssrf). */
export const monitorUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      );
    } catch {
      return false;
    }
  }, 'Must be an http(s) URL without embedded credentials');

// ───────── auth & profile ─────────

export const registerSchema = z.object({
  name: trimmed(1, 100),
  email: emailSchema,
  password: passwordSchema,
  organizationName: trimmed(2, 100),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(128),
  password: passwordSchema,
});
export const updateProfileSchema = z.object({ name: trimmed(1, 100) });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

// ───────── organisations ─────────

export const createOrganizationSchema = z.object({ name: trimmed(2, 100) });
export const updateOrganizationSchema = z
  .object({
    name: trimmed(2, 100),
    aiMonthlyBudgetUsd: z.number().min(0).max(10_000),
    logRetentionDays: z.number().int().min(1).max(90),
    checkRetentionDays: z.number().int().min(1).max(365),
  })
  .partial();
export const addMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(ORG_ROLES),
});
export const updateMemberSchema = z.object({ role: z.enum(ORG_ROLES) });

// ───────── projects & applications ─────────

export const createProjectSchema = z.object({
  name: trimmed(1, 100),
  description: trimmed(0, 500).optional(),
});
export const updateProjectSchema = createProjectSchema.partial();

export const createApplicationSchema = z.object({
  projectId: idSchema,
  name: trimmed(1, 100),
  description: trimmed(0, 500).optional(),
  environment: z.enum(APP_ENVIRONMENTS).default('PRODUCTION'),
});
export type CreateApplicationInput = z.input<typeof createApplicationSchema>;
export const updateApplicationSchema = createApplicationSchema.omit({ projectId: true }).partial();

// ───────── monitors ─────────

const monitorFields = z.object({
  name: trimmed(1, 100),
  url: monitorUrlSchema,
  method: z.enum(HTTP_METHODS).default('GET'),
  expectedStatusCodes: z.array(z.number().int().min(100).max(599)).max(20).default([]),
  intervalSeconds: z.number().int().min(30).max(86_400).default(60),
  timeoutMs: z.number().int().min(1_000).max(30_000).default(10_000),
  failureThreshold: z.number().int().min(1).max(10).default(3),
  latencyThresholdMs: z.number().int().min(50).max(60_000).nullable().optional(),
  isActive: z.boolean().default(true),
});

const timeoutBelowInterval = (v: { timeoutMs?: number; intervalSeconds?: number }) =>
  v.timeoutMs === undefined ||
  v.intervalSeconds === undefined ||
  v.timeoutMs < v.intervalSeconds * 1000;

export const createMonitorSchema = monitorFields
  .extend({ applicationId: idSchema })
  .refine(timeoutBelowInterval, {
    message: 'Timeout must be shorter than the interval',
    path: ['timeoutMs'],
  });
export type CreateMonitorInput = z.input<typeof createMonitorSchema>;

export const updateMonitorSchema = z
  .object({
    name: monitorFields.shape.name,
    url: monitorFields.shape.url,
    method: z.enum(HTTP_METHODS),
    expectedStatusCodes: z.array(z.number().int().min(100).max(599)).max(20),
    intervalSeconds: z.number().int().min(30).max(86_400),
    timeoutMs: z.number().int().min(1_000).max(30_000),
    failureThreshold: z.number().int().min(1).max(10),
    latencyThresholdMs: z.number().int().min(50).max(60_000).nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine(timeoutBelowInterval, {
    message: 'Timeout must be shorter than the interval',
    path: ['timeoutMs'],
  });

// ───────── incidents ─────────

export const createIncidentSchema = z.object({
  applicationId: idSchema,
  title: trimmed(3, 200),
  severity: z.enum(SEVERITIES),
  probableCause: trimmed(0, 2000).optional(),
});
export const updateIncidentSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES),
    severity: z.enum(SEVERITIES),
    assigneeId: idSchema.nullable(),
    probableCause: trimmed(0, 2000).nullable(),
    resolutionNote: trimmed(0, 2000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export const incidentCommentSchema = z.object({ message: trimmed(1, 4000) });

export const incidentQuerySchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  active: queryBoolean.optional(),
  applicationId: idSchema.optional(),
  severity: z.enum(SEVERITIES).optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// ───────── logs ─────────

export const MAX_LOG_MESSAGE = 8192;
export const MAX_LOG_METADATA_BYTES = 8192;
export const MAX_LOG_BATCH = 100;

export const ingestLogSchema = z.object({
  timestamp: z.iso.datetime({ offset: true }).optional(),
  severity: z.enum(LOG_SEVERITIES),
  environment: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_-]+$/i, 'Use letters, digits, - or _')
    .default('production'),
  message: z.string().min(1).max(MAX_LOG_MESSAGE),
  metadata: z
    .record(z.string().max(100), z.unknown())
    .optional()
    .refine(
      (m) => m === undefined || JSON.stringify(m).length <= MAX_LOG_METADATA_BYTES,
      `metadata must serialise to at most ${MAX_LOG_METADATA_BYTES} bytes`,
    ),
});
export type IngestLogInput = z.input<typeof ingestLogSchema>;
export const ingestBatchSchema = z.object({
  logs: z.array(ingestLogSchema).min(1).max(MAX_LOG_BATCH),
});

const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.array(z.enum(values))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional();

export const logQuerySchema = z.object({
  applicationId: idSchema.optional(),
  errorGroupId: idSchema.optional(),
  severity: csvEnum(LOG_SEVERITIES),
  environment: z.string().max(32).optional(),
  q: z.string().trim().max(200).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createApiKeySchema = z.object({ name: trimmed(1, 100) });

// ───────── dashboard & reliability ─────────

export const TIME_RANGES = ['24h', '7d', '30d'] as const;
export type TimeRange = (typeof TIME_RANGES)[number];
export const TIME_RANGE_MS: Record<TimeRange, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
};
export const rangeQuerySchema = z.object({
  range: z.enum(TIME_RANGES).default('24h'),
  applicationId: idSchema.optional(),
});

export const checkQuerySchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ───────── AI ─────────

export const requestAnalysisSchema = z.object({
  targetType: z.enum(AI_ANALYSIS_TARGETS),
  targetId: idSchema,
});

// ───────── notifications ─────────

export const createChannelSchema = z
  .object({
    type: z.enum(CHANNEL_TYPES),
    name: trimmed(1, 100),
    target: z.string().trim().min(3).max(2048),
    events: z.array(z.enum(NOTIFICATION_TYPES)).min(1),
  })
  .refine(
    (v) =>
      v.type === 'EMAIL'
        ? z.email().safeParse(v.target).success
        : monitorUrlSchema.safeParse(v.target).success,
    {
      message: 'Target must be an e-mail address (EMAIL) or an https URL (WEBHOOK)',
      path: ['target'],
    },
  );
export const updateChannelSchema = z.object({ isEnabled: z.boolean() });

export const notificationQuerySchema = z.object({
  unread: queryBoolean.optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
