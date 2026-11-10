import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Prisma } from '@devpulse/database';
import {
  flapRate,
  isUnstable,
  rangeQuerySchema,
  TIME_RANGE_MS,
  type TimeRange,
  uptimeFromCounts,
} from '@devpulse/shared';
import { Membership, type OrgMembership, RequirePermission } from '../../common/context.js';
import { ZodQuery } from '../../common/zod.js';
import { PRISMA, type PrismaClient } from '../../database/prisma.service.js';
import { aggregateStatus } from '../applications/applications.controller.js';

const BUCKET: Record<TimeRange, string> = { '24h': '1 hour', '7d': '6 hours', '30d': '1 day' };

type RangeQuery = z.output<typeof rangeQuerySchema>;

@ApiTags('dashboard & reliability')
@Controller('orgs/:orgId')
export class DashboardController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('dashboard')
  @RequirePermission('org:read')
  async dashboard(@Membership() m: OrgMembership, @ZodQuery(rangeQuerySchema) q: RangeQuery) {
    const orgId = m.organizationId;
    const since = new Date(Date.now() - TIME_RANGE_MS[q.range]);
    const appFilter = q.applicationId
      ? Prisma.sql`AND m."applicationId" = ${q.applicationId}::uuid`
      : Prisma.empty;
    const bucket = Prisma.raw(`'${BUCKET[q.range]}'::interval`);

    const [apps, totals, series, incidentsInRange, openIncidents, recentErrors, activity] =
      await Promise.all([
        this.prisma.application.findMany({
          where: { organizationId: orgId, ...(q.applicationId ? { id: q.applicationId } : {}) },
          select: { id: true, monitors: { select: { status: true } } },
        }),
        this.prisma.$queryRaw<{ total: number; down: number; avg_latency: number | null }[]>`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE c."result" = 'DOWN')::int AS down,
               ROUND(AVG(c."latencyMs") FILTER (WHERE c."result" <> 'DOWN'))::int AS avg_latency
        FROM "MonitorCheck" c JOIN "Monitor" m ON m."id" = c."monitorId"
        WHERE c."organizationId" = ${orgId}::uuid AND c."checkedAt" >= ${since} ${appFilter}`,
        this.prisma.$queryRaw<
          {
            bucket: Date;
            total: number;
            down: number;
            avg_latency: number | null;
            p95_latency: number | null;
          }[]
        >`
        SELECT date_bin(${bucket}, c."checkedAt", TIMESTAMPTZ '2000-01-01') AS bucket,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE c."result" = 'DOWN')::int AS down,
               ROUND(AVG(c."latencyMs") FILTER (WHERE c."result" <> 'DOWN'))::int AS avg_latency,
               ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY c."latencyMs") FILTER (WHERE c."result" <> 'DOWN'))::int AS p95_latency
        FROM "MonitorCheck" c JOIN "Monitor" m ON m."id" = c."monitorId"
        WHERE c."organizationId" = ${orgId}::uuid AND c."checkedAt" >= ${since} ${appFilter}
        GROUP BY 1 ORDER BY 1`,
        this.prisma.incident.count({
          where: {
            organizationId: orgId,
            openedAt: { gte: since },
            ...(q.applicationId ? { applicationId: q.applicationId } : {}),
          },
        }),
        this.prisma.incident.count({
          where: {
            organizationId: orgId,
            status: { not: 'RESOLVED' },
            ...(q.applicationId ? { applicationId: q.applicationId } : {}),
          },
        }),
        this.prisma.errorGroup.findMany({
          where: {
            organizationId: orgId,
            lastSeenAt: { gte: since },
            ...(q.applicationId ? { applicationId: q.applicationId } : {}),
          },
          orderBy: { lastSeenAt: 'desc' },
          take: 6,
          select: {
            id: true,
            title: true,
            errorType: true,
            severity: true,
            count: true,
            lastSeenAt: true,
            application: { select: { id: true, name: true } },
          },
        }),
        this.prisma.incidentEvent.findMany({
          where: {
            organizationId: orgId,
            ...(q.applicationId ? { incident: { applicationId: q.applicationId } } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: {
            id: true,
            type: true,
            message: true,
            createdAt: true,
            actor: { select: { name: true } },
            incident: { select: { id: true, title: true, severity: true } },
          },
        }),
      ]);

    const statuses = apps.map((a) => aggregateStatus(a.monitors.map((mo) => mo.status)));
    const t = totals[0] ?? { total: 0, down: 0, avg_latency: null };
    return {
      range: q.range,
      applications: {
        total: apps.length,
        online: statuses.filter((s) => s === 'UP' || s === 'DEGRADED').length,
        offline: statuses.filter((s) => s === 'DOWN').length,
        pending: statuses.filter((s) => s === 'PENDING' || s === 'NO_MONITORS').length,
      },
      uptime: uptimeFromCounts(t.total, t.down),
      avgResponseMs: t.avg_latency,
      checks: t.total,
      incidents: { inRange: incidentsInRange, open: openIncidents },
      series: series.map((s) => ({
        bucket: s.bucket,
        uptime: uptimeFromCounts(s.total, s.down),
        avgLatencyMs: s.avg_latency,
        p95LatencyMs: s.p95_latency,
        checks: s.total,
        failures: s.down,
      })),
      recentErrors,
      activity,
    };
  }

  /** Per-monitor reliability: uptime, latency percentiles, flapping and regressions vs. previous period. */
  @Get('reliability')
  @RequirePermission('org:read')
  async reliability(@Membership() m: OrgMembership, @ZodQuery(rangeQuerySchema) q: RangeQuery) {
    const orgId = m.organizationId;
    const span = TIME_RANGE_MS[q.range];
    const now = Date.now();
    const since = new Date(now - span);
    const prevSince = new Date(now - 2 * span);
    const appFilter = q.applicationId
      ? Prisma.sql`AND m."applicationId" = ${q.applicationId}::uuid`
      : Prisma.empty;

    type Row = {
      monitor_id: string;
      period: 'current' | 'previous';
      total: number;
      down: number;
      degraded: number;
      avg: number | null;
      p50: number | null;
      p95: number | null;
      p99: number | null;
    };
    const [monitors, stats, sequences] = await Promise.all([
      this.prisma.monitor.findMany({
        where: {
          organizationId: orgId,
          ...(q.applicationId ? { applicationId: q.applicationId } : {}),
        },
        select: {
          id: true,
          name: true,
          url: true,
          status: true,
          latencyThresholdMs: true,
          application: { select: { id: true, name: true } },
        },
      }),
      this.prisma.$queryRaw<Row[]>`
        SELECT c."monitorId" AS monitor_id,
               CASE WHEN c."checkedAt" >= ${since} THEN 'current' ELSE 'previous' END AS period,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE c."result" = 'DOWN')::int AS down,
               COUNT(*) FILTER (WHERE c."result" = 'DEGRADED')::int AS degraded,
               ROUND(AVG(c."latencyMs") FILTER (WHERE c."result" <> 'DOWN'))::int AS avg,
               ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY c."latencyMs") FILTER (WHERE c."result" <> 'DOWN'))::int AS p50,
               ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY c."latencyMs") FILTER (WHERE c."result" <> 'DOWN'))::int AS p95,
               ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY c."latencyMs") FILTER (WHERE c."result" <> 'DOWN'))::int AS p99
        FROM "MonitorCheck" c JOIN "Monitor" m ON m."id" = c."monitorId"
        WHERE c."organizationId" = ${orgId}::uuid AND c."checkedAt" >= ${prevSince} ${appFilter}
        GROUP BY 1, 2`,
      // Results in chronological order for flap detection (bounded per monitor).
      this.prisma.$queryRaw<{ monitor_id: string; results: string[] }[]>`
        SELECT x.monitor_id, array_agg(x.result ORDER BY x."checkedAt") AS results FROM (
          SELECT c."monitorId" AS monitor_id, c."result"::text AS result, c."checkedAt",
                 row_number() OVER (PARTITION BY c."monitorId" ORDER BY c."checkedAt" DESC) AS rn
          FROM "MonitorCheck" c JOIN "Monitor" m ON m."id" = c."monitorId"
          WHERE c."organizationId" = ${orgId}::uuid AND c."checkedAt" >= ${since} ${appFilter}
        ) x WHERE x.rn <= 500 GROUP BY 1`,
    ]);

    const statsBy = new Map(stats.map((s) => [`${s.monitor_id}:${s.period}`, s]));
    const seqBy = new Map(sequences.map((s) => [s.monitor_id, s.results]));

    const rows = monitors.map((mo) => {
      const cur = statsBy.get(`${mo.id}:current`);
      const prev = statsBy.get(`${mo.id}:previous`);
      const uptime = cur ? uptimeFromCounts(cur.total, cur.down) : null;
      const prevUptime = prev ? uptimeFromCounts(prev.total, prev.down) : null;
      const flap = flapRate(
        (seqBy.get(mo.id) ?? []).map((r) => ({ result: r as 'UP' | 'DOWN' | 'DEGRADED' })),
      );
      const stability = isUnstable({
        uptime,
        flapRate: flap,
        p95LatencyMs: cur?.p95 ?? null,
        latencyThresholdMs: mo.latencyThresholdMs,
      });

      const regressions: string[] = [];
      if (uptime !== null && prevUptime !== null && prevUptime - uptime >= 0.5) {
        regressions.push(`Uptime dropped from ${prevUptime}% to ${uptime}%`);
      }
      if (cur?.p95 && prev?.p95 && cur.p95 > prev.p95 * 1.25 && cur.p95 - prev.p95 > 50) {
        regressions.push(`p95 latency rose from ${prev.p95}ms to ${cur.p95}ms`);
      }
      return {
        monitor: mo,
        checks: cur?.total ?? 0,
        successRate:
          cur && cur.total > 0
            ? Math.round(((cur.total - cur.down) / cur.total) * 1000) / 10
            : null,
        failureRate: cur && cur.total > 0 ? Math.round((cur.down / cur.total) * 1000) / 10 : null,
        degradedChecks: cur?.degraded ?? 0,
        uptime,
        previousUptime: prevUptime,
        latency: {
          avg: cur?.avg ?? null,
          p50: cur?.p50 ?? null,
          p95: cur?.p95 ?? null,
          p99: cur?.p99 ?? null,
        },
        flapRate: flap,
        unstable: stability.unstable,
        instabilityReasons: stability.reasons,
        regressions,
      };
    });

    const totals = rows.reduce((acc, r) => ({ checks: acc.checks + r.checks }), { checks: 0 });
    return {
      range: q.range,
      // Availability measures HTTP reachability only; it says nothing about functional test coverage.
      scope: 'http-availability',
      totals: {
        ...totals,
        unstable: rows.filter((r) => r.unstable).length,
        regressions: rows.filter((r) => r.regressions.length > 0).length,
      },
      monitors: rows,
    };
  }
}
