import type {
  AppEnvironment,
  CheckErrorType,
  CheckResult,
  MonitorStatus,
  Severity,
} from './enums.js';

export interface HttpOutcome {
  statusCode: number | null;
  latencyMs: number | null;
  errorType: CheckErrorType | null;
  errorMessage: string | null;
}

export interface MonitorExpectations {
  expectedStatusCodes: readonly number[];
  latencyThresholdMs: number | null;
}

/** Classifies a raw HTTP outcome into UP / DEGRADED / DOWN. */
export function classifyOutcome(
  outcome: HttpOutcome,
  expect: MonitorExpectations,
): {
  result: CheckResult;
  errorType: CheckErrorType | null;
  errorMessage: string | null;
} {
  if (outcome.errorType || outcome.statusCode === null) {
    return {
      result: 'DOWN',
      errorType: outcome.errorType ?? 'UNKNOWN',
      errorMessage: outcome.errorMessage,
    };
  }
  const accepted =
    expect.expectedStatusCodes.length > 0
      ? expect.expectedStatusCodes.includes(outcome.statusCode)
      : outcome.statusCode >= 200 && outcome.statusCode < 300;
  if (!accepted) {
    return {
      result: 'DOWN',
      errorType: 'STATUS_CODE',
      errorMessage: `Unexpected status code ${outcome.statusCode}`,
    };
  }
  if (
    expect.latencyThresholdMs !== null &&
    outcome.latencyMs !== null &&
    outcome.latencyMs > expect.latencyThresholdMs
  ) {
    return {
      result: 'DEGRADED',
      errorType: null,
      errorMessage: `Latency ${outcome.latencyMs}ms above threshold ${expect.latencyThresholdMs}ms`,
    };
  }
  return { result: 'UP', errorType: null, errorMessage: null };
}

export interface MonitorState {
  status: MonitorStatus;
  consecutiveFailures: number;
  failureThreshold: number;
  hasOpenIncident: boolean;
}

export type MonitorAction =
  | { type: 'NONE' }
  | { type: 'OPEN_INCIDENT' }
  | { type: 'APPEND_FAILURE' }
  | { type: 'RESOLVE_INCIDENT' };

export interface Transition {
  status: MonitorStatus;
  consecutiveFailures: number;
  action: MonitorAction;
  /** True when the visible status changed (used for notifications). */
  statusChanged: boolean;
  latencyBreached: boolean;
}

/**
 * Pure state machine applied after every check.
 * - A monitor only becomes DOWN after `failureThreshold` consecutive failures (avoids
 *   paging on a single blip); until then it keeps its previous visible status.
 * - Opening an incident happens exactly when the threshold is reached and none is open.
 * - The first successful check after DOWN resolves the automatic incident.
 */
export function applyCheck(state: MonitorState, result: CheckResult): Transition {
  if (result === 'DOWN') {
    const failures = state.consecutiveFailures + 1;
    const reached = failures >= state.failureThreshold;
    const status: MonitorStatus = reached ? 'DOWN' : state.status;
    let action: MonitorAction = { type: 'NONE' };
    if (reached && !state.hasOpenIncident) {
      action = { type: 'OPEN_INCIDENT' };
    } else if (reached && state.hasOpenIncident) {
      action = { type: 'APPEND_FAILURE' };
    }
    return {
      status,
      consecutiveFailures: failures,
      action,
      statusChanged: status !== state.status,
      latencyBreached: false,
    };
  }

  const status: MonitorStatus = result === 'DEGRADED' ? 'DEGRADED' : 'UP';
  return {
    status,
    consecutiveFailures: 0,
    action: state.hasOpenIncident ? { type: 'RESOLVE_INCIDENT' } : { type: 'NONE' },
    statusChanged: status !== state.status,
    latencyBreached: result === 'DEGRADED' && state.status !== 'DEGRADED',
  };
}

/** An outage's severity follows the blast radius of the environment it affects. */
export function severityForOutage(environment: AppEnvironment): Severity {
  switch (environment) {
    case 'PRODUCTION':
      return 'CRITICAL';
    case 'STAGING':
      return 'MEDIUM';
    case 'DEVELOPMENT':
      return 'LOW';
  }
}
