'use client';

import { useQuery } from '@tanstack/react-query';
import type { TimeRange } from '@devpulse/shared';
import {
  Activity,
  AppWindow,
  ArrowDownCircle,
  CheckCircle2,
  Plus,
  Siren,
  Timer,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { LatencyChart, UptimeChart } from '@/components/charts';
import { ApplicationFilter, RangeToggle, useApplications } from '@/components/filters';
import { EmptyState, ErrorState, PageHeader, StatTile } from '@/components/page';
import { LogSeverityBadge, SeverityBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui/primitives';
import { useOrgKey, useSession } from '@/features/session/session';
import { api, errorMessage } from '@/lib/api';
import type { Dashboard } from '@/lib/types';
import { formatMs, formatPercent, timeAgo } from '@/lib/utils';

export default function DashboardPage() {
  const { orgPath, org, can } = useSession();
  const [range, setRange] = React.useState<TimeRange>('24h');
  const [app, setApp] = React.useState('all');
  const applicationId = app === 'all' ? undefined : app;
  const apps = useApplications();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: useOrgKey('dashboard', range, applicationId),
    queryFn: () => api.get<Dashboard>(`${orgPath}/dashboard`, { range, applicationId }),
    refetchInterval: 30_000,
  });

  if (apps.data && apps.data.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" description={`Overview of ${org.name}`} />
        <EmptyState
          icon={AppWindow}
          title="No applications yet"
          description="Add your first application and point a monitor at it. Metrics appear here after the first check."
          action={
            can('apps:write') ? (
              <Button asChild>
                <Link href="/applications?new=1">
                  <Plus /> Add application
                </Link>
              </Button>
            ) : undefined
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Overview of ${org.name}`}
        actions={
          <>
            <ApplicationFilter value={app} onChange={setApp} />
            <RangeToggle value={range} onChange={setRange} />
          </>
        }
      />
      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile
              label="Applications"
              icon={AppWindow}
              loading={isPending}
              value={data?.applications.total}
              hint={data ? `${data.applications.pending} pending or without monitors` : undefined}
            />
            <StatTile
              label="Online"
              icon={CheckCircle2}
              loading={isPending}
              value={<span data-testid="kpi-online">{data?.applications.online}</span>}
              hint={
                data && data.applications.offline > 0 ? (
                  <span className="inline-flex items-center gap-1 text-critical-text">
                    <ArrowDownCircle className="size-3" aria-hidden /> {data.applications.offline}{' '}
                    offline
                  </span>
                ) : (
                  'None offline'
                )
              }
            />
            <StatTile
              label={`Uptime · ${range}`}
              icon={Activity}
              loading={isPending}
              value={<span data-testid="kpi-uptime">{formatPercent(data?.uptime)}</span>}
              hint={data ? `${data.checks.toLocaleString()} checks` : undefined}
            />
            <StatTile
              label="Avg response"
              icon={Timer}
              loading={isPending}
              value={formatMs(data?.avgResponseMs)}
              hint="Successful checks only"
            />
            <StatTile
              label="Incidents"
              icon={Siren}
              loading={isPending}
              value={<span data-testid="kpi-incidents">{data?.incidents.inRange}</span>}
              hint={
                data ? (
                  <Link href="/incidents" className="hover:underline">
                    {data.incidents.open} currently open
                  </Link>
                ) : undefined
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Availability</CardTitle>
                  <CardDescription>Share of checks that succeeded, per interval</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {isPending ? (
                  <Skeleton className="h-[220px]" />
                ) : data && data.series.length > 0 ? (
                  <UptimeChart data={data.series} range={range} />
                ) : (
                  <NoData />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Response time</CardTitle>
                  <CardDescription>Average and 95th percentile latency</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {isPending ? (
                  <Skeleton className="h-[220px]" />
                ) : data && data.series.length > 0 ? (
                  <LatencyChart data={data.series} range={range} />
                ) : (
                  <NoData />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Recent errors</CardTitle>
                  <CardDescription>Error groups seen in this period</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/logs?tab=groups">View all</Link>
                </Button>
              </CardHeader>
              <CardContent className="pt-3">
                {isPending ? (
                  <Skeleton className="h-40" />
                ) : data?.recentErrors.length ? (
                  <ul className="divide-y divide-border">
                    {data.recentErrors.map((g) => (
                      <li key={g.id} className="flex items-center gap-3 py-2.5">
                        <LogSeverityBadge severity={g.severity} />
                        <Link
                          href={`/logs/groups/${g.id}`}
                          className="min-w-0 flex-1 truncate text-sm hover:underline"
                        >
                          {g.title}
                        </Link>
                        <span className="text-xs text-muted-foreground tabular">{g.count}×</span>
                        <span className="hidden w-20 text-right text-xs text-muted-foreground sm:block">
                          {timeAgo(g.lastSeenAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No errors ingested in this period.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Recent activity</CardTitle>
                  <CardDescription>Latest incident events</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-3">
                {isPending ? (
                  <Skeleton className="h-40" />
                ) : data?.activity.length ? (
                  <ol className="space-y-3">
                    {data.activity.map((a) => (
                      <li key={a.id} className="flex gap-3 text-sm">
                        <span
                          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-subtle-foreground"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/incidents/${a.incident.id}`}
                            className="font-medium hover:underline"
                          >
                            {a.incident.title}
                          </Link>
                          <p className="line-clamp-2 text-muted-foreground">{a.message}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <SeverityBadge severity={a.incident.severity} />
                          <span className="text-xs text-subtle-foreground">
                            {timeAgo(a.createdAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No incident activity yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function NoData() {
  return (
    <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
      No checks in this period yet.
    </div>
  );
}
