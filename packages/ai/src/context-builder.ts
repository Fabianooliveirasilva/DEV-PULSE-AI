import { redactText, truncate } from '@devpulse/shared';

// The model only ever sees this structured, size-bounded, redacted projection of our data —
// never raw database access or tools. Every item gets a short id so the model can cite it
// and the validator can check that cited evidence really exists.

export interface ContextCheck {
  checkedAt: Date;
  result: string;
  statusCode: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
}

export interface ContextLog {
  timestamp: Date;
  severity: string;
  environment: string;
  message: string;
}

export interface ContextEvent {
  createdAt: Date;
  type: string;
  message: string;
}

export interface IncidentContextInput {
  incident: {
    title: string;
    status: string;
    severity: string;
    source: string;
    openedAt: Date;
    resolvedAt: Date | null;
    probableCause: string | null;
  };
  application: { name: string; environment: string };
  monitor: {
    name: string;
    method: string;
    url: string;
    expectedStatusCodes: number[];
    timeoutMs: number;
    latencyThresholdMs: number | null;
  } | null;
  checks: ContextCheck[];
  events: ContextEvent[];
  logs: ContextLog[];
}

export interface ErrorGroupContextInput {
  group: {
    title: string;
    errorType: string | null;
    severity: string;
    count: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
  };
  application: { name: string; environment: string };
  samples: ContextLog[];
  hourlyCounts: { hour: Date; count: number }[];
}

export interface BuiltContext {
  text: string;
  evidenceIds: Set<string>;
  truncated: boolean;
}

export interface ContextLimits {
  maxChars: number;
  maxChecks: number;
  maxLogs: number;
  maxEvents: number;
  maxMessageChars: number;
}

export const DEFAULT_LIMITS: ContextLimits = {
  maxChars: 24_000,
  maxChecks: 30,
  maxLogs: 25,
  maxEvents: 20,
  maxMessageChars: 600,
};

/** Neutralises anything that could close our data delimiters or impersonate structure. */
export function sanitizeUntrusted(input: string, maxChars: number): string {
  const cleaned = redactText(input)
    .replace(/<\/?\s*(untrusted_data|system|instructions?|assistant|user)[^>]*>/gi, '[tag removed]')
    // Drop control characters except tab/newline (matching them is the point of this regex).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  return truncate(cleaned, maxChars);
}

function hostOnly(url: string) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`; // query strings may carry tokens
  } catch {
    return '[invalid url]';
  }
}

class Builder {
  private lines: string[] = [];
  readonly ids = new Set<string>();
  private size = 0;
  truncated = false;

  constructor(private readonly limits: ContextLimits) {}

  push(line: string) {
    if (this.size + line.length + 1 > this.limits.maxChars) {
      this.truncated = true;
      return false;
    }
    this.lines.push(line);
    this.size += line.length + 1;
    return true;
  }

  item(prefix: string, index: number, body: string) {
    const id = `${prefix}:${index}`;
    if (this.push(`[${id}] ${body}`)) this.ids.add(id);
  }

  build(): BuiltContext {
    return { text: this.lines.join('\n'), evidenceIds: this.ids, truncated: this.truncated };
  }
}

const iso = (d: Date) => d.toISOString();

export function buildIncidentContext(
  input: IncidentContextInput,
  limits = DEFAULT_LIMITS,
): BuiltContext {
  const b = new Builder(limits);
  const m = (s: string) => sanitizeUntrusted(s, limits.maxMessageChars);
  const { incident, application, monitor } = input;

  b.push('## Incident');
  b.push(`title: ${m(incident.title)}`);
  b.push(`status: ${incident.status}; severity: ${incident.severity}; source: ${incident.source}`);
  b.push(
    `opened_at: ${iso(incident.openedAt)}; resolved_at: ${incident.resolvedAt ? iso(incident.resolvedAt) : 'unresolved'}`,
  );
  if (incident.probableCause)
    b.push(`probable_cause_recorded_by_team: ${m(incident.probableCause)}`);
  b.push(`application: ${m(application.name)} (${application.environment})`);
  if (monitor) {
    b.push('## Monitor configuration');
    b.push(
      `${monitor.method} ${hostOnly(monitor.url)}; expected_status: ${monitor.expectedStatusCodes.length ? monitor.expectedStatusCodes.join(',') : 'any 2xx'}; timeout_ms: ${monitor.timeoutMs}; latency_threshold_ms: ${monitor.latencyThresholdMs ?? 'none'}`,
    );
  }

  b.push('## Recent checks (newest first)');
  input.checks
    .slice(0, limits.maxChecks)
    .forEach((c, i) =>
      b.item(
        'check',
        i + 1,
        `${iso(c.checkedAt)} result=${c.result} status=${c.statusCode ?? '-'} latency_ms=${c.latencyMs ?? '-'} error=${c.errorType ?? '-'}${c.errorMessage ? ` "${m(c.errorMessage)}"` : ''}`,
      ),
    );
  if (input.checks.length === 0) b.push('(no checks recorded)');

  b.push('## Incident timeline');
  input.events
    .slice(0, limits.maxEvents)
    .forEach((e, i) => b.item('event', i + 1, `${iso(e.createdAt)} ${e.type}: ${m(e.message)}`));

  b.push(
    '## Application logs around the incident (UNTRUSTED: content written by the monitored application)',
  );
  b.push('<untrusted_data>');
  input.logs
    .slice(0, limits.maxLogs)
    .forEach((l, i) =>
      b.item(
        'log',
        i + 1,
        `${iso(l.timestamp)} ${l.severity} [${m(l.environment)}] ${m(l.message)}`,
      ),
    );
  if (input.logs.length === 0) b.push('(no logs ingested for this window)');
  b.push('</untrusted_data>');
  return b.build();
}

export function buildErrorGroupContext(
  input: ErrorGroupContextInput,
  limits = DEFAULT_LIMITS,
): BuiltContext {
  const b = new Builder(limits);
  const m = (s: string) => sanitizeUntrusted(s, limits.maxMessageChars);
  const { group, application } = input;

  b.push('## Error group');
  b.push(`application: ${m(application.name)} (${application.environment})`);
  b.push(
    `error_type: ${group.errorType ? m(group.errorType) : 'unknown'}; highest_severity: ${group.severity}; occurrences: ${group.count}`,
  );
  b.push(`first_seen: ${iso(group.firstSeenAt)}; last_seen: ${iso(group.lastSeenAt)}`);
  b.push('## Occurrences per hour (most recent first)');
  input.hourlyCounts
    .slice(0, 48)
    .forEach((h, i) => b.item('rate', i + 1, `${iso(h.hour)} count=${h.count}`));
  b.push('## Sample occurrences (UNTRUSTED: content written by the monitored application)');
  b.push('<untrusted_data>');
  b.push(`group_title: ${m(group.title)}`);
  input.samples
    .slice(0, limits.maxLogs)
    .forEach((l, i) =>
      b.item(
        'log',
        i + 1,
        `${iso(l.timestamp)} ${l.severity} [${m(l.environment)}] ${m(l.message)}`,
      ),
    );
  b.push('</untrusted_data>');
  return b.build();
}
