import type {
  AIAnalysisStatus,
  AppEnvironment,
  CheckErrorType,
  CheckResult,
  HttpMethod,
  IncidentEventType,
  IncidentSource,
  IncidentStatus,
  LogSeverity,
  MonitorStatus,
  NotificationType,
  OrgRole,
  Severity,
} from '@devpulse/shared';

// Shapes of API responses as consumed by the UI (dates arrive as ISO strings).

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  organizations: { id: string; name: string; slug: string; role: OrgRole }[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  aiMonthlyBudgetUsd: string;
  logRetentionDays: number;
  checkRetentionDays: number;
  role: OrgRole;
}

export interface Member {
  id: string;
  role: OrgRole;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  _count: { applications: number };
}

export type AppStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'PENDING' | 'NO_MONITORS';

export interface ApplicationSummary {
  id: string;
  name: string;
  description: string | null;
  environment: AppEnvironment;
  project: { id: string; name: string };
  status: AppStatus;
  monitorCount: number;
  openIncidents: number;
  lastCheckedAt: string | null;
}

export interface Monitor {
  id: string;
  applicationId: string;
  name: string;
  url: string;
  method: HttpMethod;
  expectedStatusCodes: number[];
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  latencyThresholdMs: number | null;
  isActive: boolean;
  status: MonitorStatus;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  application?: { id: string; name: string; environment: AppEnvironment };
}

export interface ApplicationDetail {
  id: string;
  name: string;
  description: string | null;
  environment: AppEnvironment;
  project: { id: string; name: string };
  monitors: Monitor[];
  incidents: IncidentSummary[];
  status: AppStatus;
  uptime: number | null;
  checkCount: number;
}

export interface MonitorCheck {
  id: string;
  result: CheckResult;
  statusCode: number | null;
  latencyMs: number | null;
  errorType: CheckErrorType | null;
  errorMessage: string | null;
  checkedAt: string;
  incidentId: string | null;
}

export interface IncidentSummary {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  source?: IncidentSource;
  openedAt: string;
  resolvedAt: string | null;
  application?: { id: string; name: string };
  assignee?: { id: string; name: string } | null;
}

export interface IncidentEvent {
  id: string;
  type: IncidentEventType;
  message: string;
  createdAt: string;
  fromStatus: IncidentStatus | null;
  toStatus: IncidentStatus | null;
  actor: { id: string; name: string } | null;
}

export interface AnalysisResult {
  summary: string;
  explanation: string;
  severity: Severity;
  severityRationale: string;
  errorCategory: string;
  hypotheses: {
    cause: string;
    status: 'HYPOTHESIS' | 'SUPPORTED_BY_EVIDENCE';
    confidence: 'low' | 'medium' | 'high';
    evidence: string[];
  }[];
  suggestedFixes: { title: string; steps: string[]; risk: 'low' | 'medium' | 'high' }[];
  preventiveActions: string[];
  missingInformation: string[];
  validationNotes?: string[];
}

export interface AIAnalysis {
  id: string;
  targetType: 'INCIDENT' | 'ERROR_GROUP';
  status: AIAnalysisStatus;
  promptVersion: string;
  provider: string | null;
  model: string | null;
  summary: string | null;
  severity: Severity | null;
  result: AnalysisResult | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  incident?: { id: string; title: string } | null;
  errorGroup?: { id: string; title: string } | null;
  requestedBy?: { id: string; name: string } | null;
  usageRecords?: { inputTokens: number; outputTokens: number; costUsd: string; model: string }[];
}

export interface IncidentDetail extends IncidentSummary {
  probableCause: string | null;
  resolutionNote: string | null;
  application: { id: string; name: string; environment: AppEnvironment };
  monitor: { id: string; name: string; url: string; method: HttpMethod } | null;
  assignee: { id: string; name: string; email: string } | null;
  events: IncidentEvent[];
  checks: MonitorCheck[];
  aiAnalyses: AIAnalysis[];
  allowedTransitions: IncidentStatus[];
}

export interface LogEntry {
  id: string;
  timestamp: string;
  severity: LogSeverity;
  environment: string;
  message: string;
  metadata: Record<string, unknown> | null;
  errorGroupId: string | null;
  application: { id: string; name: string };
}

export interface ErrorGroup {
  id: string;
  title: string;
  errorType: string | null;
  severity: LogSeverity;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  application: { id: string; name: string; environment?: AppEnvironment };
}

export interface ErrorGroupDetail extends ErrorGroup {
  logs: Omit<LogEntry, 'application' | 'errorGroupId'>[];
  aiAnalyses: AIAnalysis[];
  hourly: { hour: string; count: number }[];
}

export interface Dashboard {
  range: string;
  applications: { total: number; online: number; offline: number; pending: number };
  uptime: number | null;
  avgResponseMs: number | null;
  checks: number;
  incidents: { inRange: number; open: number };
  series: {
    bucket: string;
    uptime: number | null;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    checks: number;
    failures: number;
  }[];
  recentErrors: ErrorGroup[];
  activity: {
    id: string;
    type: IncidentEventType;
    message: string;
    createdAt: string;
    actor: { name: string } | null;
    incident: { id: string; title: string; severity: Severity };
  }[];
}

export interface ReliabilityRow {
  monitor: {
    id: string;
    name: string;
    url: string;
    status: MonitorStatus;
    latencyThresholdMs: number | null;
    application: { id: string; name: string };
  };
  checks: number;
  successRate: number | null;
  failureRate: number | null;
  degradedChecks: number;
  uptime: number | null;
  previousUptime: number | null;
  latency: { avg: number | null; p50: number | null; p95: number | null; p99: number | null };
  flapRate: number;
  unstable: boolean;
  instabilityReasons: string[];
  regressions: string[];
}

export interface Reliability {
  range: string;
  scope: string;
  totals: { checks: number; unstable: number; regressions: number };
  monitors: ReliabilityRow[];
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  incidentId: string | null;
  applicationId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationChannel {
  id: string;
  type: 'EMAIL' | 'WEBHOOK';
  name: string;
  target: string;
  events: NotificationType[];
  isEnabled: boolean;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  key?: string;
}

export interface AiStatus {
  configured: boolean;
  provider: string;
  monthlyBudgetUsd: number;
  spentThisMonthUsd: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}
