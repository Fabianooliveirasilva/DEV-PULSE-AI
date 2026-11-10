'use client';

import type { TimeRange } from '@devpulse/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Gauge, Info, TrendingDown } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ApplicationFilter, RangeToggle } from '@/components/filters';
import { EmptyState, ErrorState, PageHeader, StatTile, TableSkeleton } from '@/components/page';
import { StatusBadge } from '@/components/status';
import { Badge, Card, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/overlays';
import { useOrgKey, useSession } from '@/features/session/session';
import { api, errorMessage } from '@/lib/api';
import type { Reliability } from '@/lib/types';
import { formatMs, formatPercent } from '@/lib/utils';

export default function ReliabilityPage() {
  const { orgPath } = useSession();
  const [range, setRange] = React.useState<TimeRange>('7d');
  const [app, setApp] = React.useState('all');
  const { data, isPending, error, refetch } = useQuery({
    queryKey: useOrgKey('reliability', range, app),
    queryFn: () =>
      api.get<Reliability>(`${orgPath}/reliability`, {
        range,
        applicationId: app === 'all' ? undefined : app,
      }),
  });

  const totalChecks = data?.totals.checks ?? 0;
  const weightedUptime =
    data && totalChecks > 0
      ? data.monitors.reduce((acc, r) => acc + (r.uptime ?? 0) * r.checks, 0) / totalChecks
      : null;

  return (
    <>
      <PageHeader
        title="Reliability Reports"
        description="Per-endpoint availability, latency percentiles, flapping and regressions against the previous period."
        actions={
          <>
            <ApplicationFilter value={app} onChange={setApp} />
            <RangeToggle value={range} onChange={setRange} />
          </>
        }
      />
      <div className="mb-6 flex gap-2 rounded-md border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        These figures measure HTTP availability and latency only. They are not a measure of
        functional test coverage or product quality. End-to-end test results can be added in a
        future integration.
      </div>
      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Checks" loading={isPending} value={totalChecks.toLocaleString()} />
            <StatTile
              label="Weighted uptime"
              loading={isPending}
              value={formatPercent(weightedUptime)}
            />
            <StatTile
              label="Unstable endpoints"
              icon={AlertTriangle}
              loading={isPending}
              value={data?.totals.unstable}
            />
            <StatTile
              label="Regressions"
              icon={TrendingDown}
              loading={isPending}
              value={data?.totals.regressions}
              hint="vs. previous period"
            />
          </div>
          {isPending ? (
            <Card>
              <TableSkeleton />
            </Card>
          ) : data.monitors.length === 0 ? (
            <EmptyState
              icon={Gauge}
              title="No monitors"
              description="Reliability metrics are computed from monitor checks."
            />
          ) : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Endpoint</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Uptime</TH>
                    <TH className="hidden text-right md:table-cell">Success / fail</TH>
                    <TH className="text-right">p50</TH>
                    <TH className="text-right">p95</TH>
                    <TH className="hidden text-right lg:table-cell">p99</TH>
                    <TH className="hidden text-right lg:table-cell">Flap rate</TH>
                    <TH>Signals</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.monitors.map((r) => (
                    <TR key={r.monitor.id}>
                      <TD className="max-w-xs">
                        <p className="truncate font-medium">{r.monitor.name}</p>
                        <Link
                          href={`/applications/${r.monitor.application.id}`}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          {r.monitor.application.name}
                        </Link>
                      </TD>
                      <TD>
                        <StatusBadge status={r.monitor.status} />
                      </TD>
                      <TD className="text-right tabular">
                        {formatPercent(r.uptime, 3)}
                        {r.previousUptime !== null && (
                          <p className="text-[11px] text-muted-foreground">
                            prev {formatPercent(r.previousUptime, 2)}
                          </p>
                        )}
                      </TD>
                      <TD className="hidden text-right tabular md:table-cell">
                        {r.successRate === null ? '—' : `${r.successRate}% / ${r.failureRate}%`}
                        <p className="text-[11px] text-muted-foreground">{r.checks} checks</p>
                      </TD>
                      <TD className="text-right tabular">{formatMs(r.latency.p50)}</TD>
                      <TD className="text-right tabular">{formatMs(r.latency.p95)}</TD>
                      <TD className="hidden text-right tabular lg:table-cell">
                        {formatMs(r.latency.p99)}
                      </TD>
                      <TD className="hidden text-right tabular lg:table-cell">
                        {Math.round(r.flapRate * 100)}%
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {r.unstable && (
                            <Tooltip content={r.instabilityReasons.join('; ')}>
                              <Badge tone="warning" tabIndex={0}>
                                <AlertTriangle aria-hidden /> Unstable
                              </Badge>
                            </Tooltip>
                          )}
                          {r.regressions.length > 0 && (
                            <Tooltip content={r.regressions.join('; ')}>
                              <Badge tone="serious" tabIndex={0}>
                                <TrendingDown aria-hidden /> Regression
                              </Badge>
                            </Tooltip>
                          )}
                          {!r.unstable && r.regressions.length === 0 && r.checks > 0 && (
                            <span className="text-xs text-muted-foreground">Stable</span>
                          )}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </>
  );
}
