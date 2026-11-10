import * as Db from '@devpulse/database';
import * as Shared from '@devpulse/shared';
import { describe, expect, it } from 'vitest';

// The browser uses string unions from @devpulse/shared instead of the Prisma client.
// This test fails if the two drift apart after a schema change.
const pairs: [string, Record<string, string>, readonly string[]][] = [
  ['OrgRole', Db.OrgRole, Shared.ORG_ROLES],
  ['AppEnvironment', Db.AppEnvironment, Shared.APP_ENVIRONMENTS],
  ['HttpMethod', Db.HttpMethod, Shared.HTTP_METHODS],
  ['MonitorStatus', Db.MonitorStatus, Shared.MONITOR_STATUSES],
  ['CheckResult', Db.CheckResult, Shared.CHECK_RESULTS],
  ['CheckErrorType', Db.CheckErrorType, Shared.CHECK_ERROR_TYPES],
  ['Severity', Db.Severity, Shared.SEVERITIES],
  ['IncidentStatus', Db.IncidentStatus, Shared.INCIDENT_STATUSES],
  ['IncidentSource', Db.IncidentSource, Shared.INCIDENT_SOURCES],
  ['IncidentEventType', Db.IncidentEventType, Shared.INCIDENT_EVENT_TYPES],
  ['LogSeverity', Db.LogSeverity, Shared.LOG_SEVERITIES],
  ['AIAnalysisTarget', Db.AIAnalysisTarget, Shared.AI_ANALYSIS_TARGETS],
  ['AIAnalysisStatus', Db.AIAnalysisStatus, Shared.AI_ANALYSIS_STATUSES],
  ['NotificationType', Db.NotificationType, Shared.NOTIFICATION_TYPES],
  ['ChannelType', Db.ChannelType, Shared.CHANNEL_TYPES],
];

describe('enum parity between Prisma schema and shared package', () => {
  it.each(pairs)('%s matches', (_name, prismaEnum, shared) => {
    expect(Object.values(prismaEnum).sort()).toEqual([...shared].sort());
  });
});
