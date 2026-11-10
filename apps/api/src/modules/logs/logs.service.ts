import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@devpulse/database';
import {
  extractErrorType,
  type IngestLogInput,
  type LogSeverity,
  MAX_LOG_MESSAGE,
  redactText,
  redactValue,
  truncate,
} from '@devpulse/shared';
import { logFingerprint } from '@devpulse/shared/node';
import type { IngestPrincipal } from '../../common/context.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';

const GROUPED: ReadonlySet<LogSeverity> = new Set(['ERROR', 'FATAL']);
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const SEVERITY_RANK: Record<LogSeverity, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
};

interface PreparedLog {
  timestamp: Date;
  severity: LogSeverity;
  environment: string;
  message: string;
  metadata: Prisma.InputJsonValue | undefined;
  fingerprint: string | null;
}

@Injectable()
export class LogsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Normalises, redacts and stores a batch; errors are grouped by message fingerprint. */
  async ingest(principal: IngestPrincipal, logs: (IngestLogInput & { environment: string })[]) {
    const now = Date.now();
    const prepared: PreparedLog[] = logs.map((log) => {
      const message = truncate(redactText(log.message), MAX_LOG_MESSAGE);
      const ts = log.timestamp ? new Date(log.timestamp).getTime() : now;
      return {
        // Clock skew: future timestamps are clamped so they cannot pin themselves to the top.
        timestamp: new Date(Math.min(ts, now + MAX_FUTURE_SKEW_MS)),
        severity: log.severity,
        environment: log.environment.toLowerCase(),
        message,
        metadata: log.metadata ? (redactValue(log.metadata) as Prisma.InputJsonValue) : undefined,
        fingerprint: GROUPED.has(log.severity) ? logFingerprint(message) : null,
      };
    });

    const groupIds = await this.upsertGroups(principal, prepared);
    await this.prisma.log.createMany({
      data: prepared.map((p) => ({
        organizationId: principal.organizationId,
        applicationId: principal.applicationId,
        errorGroupId: p.fingerprint ? (groupIds.get(p.fingerprint) ?? null) : null,
        timestamp: p.timestamp,
        severity: p.severity,
        environment: p.environment,
        message: p.message,
        metadata: p.metadata,
      })),
    });
    await this.prisma.apiKey.updateMany({
      where: {
        id: principal.apiKeyId,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now - 60_000) } }],
      },
      data: { lastUsedAt: new Date(now) },
    });
    return { accepted: prepared.length, grouped: prepared.filter((p) => p.fingerprint).length };
  }

  private async upsertGroups(principal: IngestPrincipal, logs: PreparedLog[]) {
    const byFingerprint = new Map<
      string,
      {
        title: string;
        errorType: string | null;
        severity: LogSeverity;
        count: number;
        first: Date;
        last: Date;
      }
    >();
    for (const log of logs) {
      if (!log.fingerprint) continue;
      const current = byFingerprint.get(log.fingerprint);
      if (!current) {
        byFingerprint.set(log.fingerprint, {
          title: truncate(log.message.split('\n', 1)[0] ?? log.message, 300),
          errorType: extractErrorType(log.message),
          severity: log.severity,
          count: 1,
          first: log.timestamp,
          last: log.timestamp,
        });
      } else {
        current.count++;
        if (SEVERITY_RANK[log.severity] > SEVERITY_RANK[current.severity])
          current.severity = log.severity;
        if (log.timestamp < current.first) current.first = log.timestamp;
        if (log.timestamp > current.last) current.last = log.timestamp;
      }
    }
    const ids = new Map<string, string>();
    for (const [fingerprint, g] of byFingerprint) {
      // Single atomic statement: concurrent batches for the same error cannot lose counts.
      // Enum comparison follows declaration order (DEBUG < … < FATAL), so GREATEST keeps the worst.
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "ErrorGroup" ("id", "organizationId", "applicationId", "fingerprint", "title", "errorType", "severity", "count", "firstSeenAt", "lastSeenAt")
        VALUES (gen_random_uuid(), ${principal.organizationId}::uuid, ${principal.applicationId}::uuid, ${fingerprint}, ${g.title}, ${g.errorType},
                ${g.severity}::"LogSeverity", ${g.count}, ${g.first}, ${g.last})
        ON CONFLICT ("applicationId", "fingerprint") DO UPDATE SET
          "count" = "ErrorGroup"."count" + EXCLUDED."count",
          "severity" = GREATEST("ErrorGroup"."severity", EXCLUDED."severity"),
          "firstSeenAt" = LEAST("ErrorGroup"."firstSeenAt", EXCLUDED."firstSeenAt"),
          "lastSeenAt" = GREATEST("ErrorGroup"."lastSeenAt", EXCLUDED."lastSeenAt")
        RETURNING "id"`;
      ids.set(fingerprint, rows[0]!.id);
    }
    return ids;
  }
}

/** Escapes LIKE wildcards so user search text is matched literally. */
export function likeEscape(input: string) {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
