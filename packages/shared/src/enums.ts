// String unions mirroring the Prisma enums. Kept here so the browser bundle never
// depends on the generated Prisma client. A unit test asserts both stay in sync.

export const ORG_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const APP_ENVIRONMENTS = ['PRODUCTION', 'STAGING', 'DEVELOPMENT'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const HTTP_METHODS = ['GET', 'HEAD', 'POST'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const MONITOR_STATUSES = ['PENDING', 'UP', 'DEGRADED', 'DOWN', 'PAUSED'] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

export const CHECK_RESULTS = ['UP', 'DEGRADED', 'DOWN'] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export const CHECK_ERROR_TYPES = [
  'TIMEOUT',
  'DNS',
  'CONNECTION',
  'TLS',
  'STATUS_CODE',
  'BLOCKED_DESTINATION',
  'TOO_MANY_REDIRECTS',
  'UNKNOWN',
] as const;
export type CheckErrorType = (typeof CHECK_ERROR_TYPES)[number];

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'IDENTIFIED',
  'MONITORING',
  'RESOLVED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_SOURCES = ['MONITOR', 'MANUAL', 'ERROR_SPIKE'] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

export const INCIDENT_EVENT_TYPES = [
  'CREATED',
  'STATUS_CHANGED',
  'SEVERITY_CHANGED',
  'ASSIGNED',
  'CAUSE_UPDATED',
  'COMMENT',
  'CHECK_FAILED',
  'RECOVERED',
  'AI_ANALYSIS',
] as const;
export type IncidentEventType = (typeof INCIDENT_EVENT_TYPES)[number];

export const LOG_SEVERITIES = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export type LogSeverity = (typeof LOG_SEVERITIES)[number];

export const AI_ANALYSIS_TARGETS = ['INCIDENT', 'ERROR_GROUP'] as const;
export type AIAnalysisTarget = (typeof AI_ANALYSIS_TARGETS)[number];

export const AI_ANALYSIS_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'NOT_CONFIGURED',
  'BUDGET_EXCEEDED',
] as const;
export type AIAnalysisStatus = (typeof AI_ANALYSIS_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'MONITOR_DOWN',
  'MONITOR_RECOVERED',
  'ERROR_SPIKE',
  'INCIDENT_CRITICAL',
  'LATENCY_THRESHOLD',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const CHANNEL_TYPES = ['EMAIL', 'WEBHOOK'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
