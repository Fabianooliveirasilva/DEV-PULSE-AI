'use client';

import { MONITOR_STATUSES } from '@devpulse/shared';
import { useQuery } from '@tanstack/react-query';
import { Activity, Plus } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/page';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/overlays';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/primitives';
import { MonitorCard, useMonitorChecks } from '@/features/monitors/monitor-card';
import { useOrgKey, useSession } from '@/features/session/session';
import { api, errorMessage } from '@/lib/api';
import type { Monitor } from '@/lib/types';
import { formatDateTime, formatMs } from '@/lib/utils';

function CheckHistory({ monitor }: { monitor: Monitor }) {
  const { data, isPending } = useMonitorChecks(monitor.id, 50);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Check history · {monitor.name}</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        {isPending ? (
          <Skeleton className="h-48" />
        ) : !data?.items.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No checks recorded yet.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>Result</TH>
                <TH className="text-right">HTTP</TH>
                <TH className="text-right">Latency</TH>
                <TH>Error</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((c) => (
                <TR key={c.id}>
                  <TD className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(c.checkedAt)}
                  </TD>
                  <TD>
                    <StatusBadge status={c.result} />
                  </TD>
                  <TD className="text-right font-mono text-xs">{c.statusCode ?? '—'}</TD>
                  <TD className="text-right tabular">{formatMs(c.latencyMs)}</TD>
                  <TD
                    className="max-w-xs truncate text-xs text-muted-foreground"
                    title={c.errorMessage ?? undefined}
                  >
                    {c.errorType
                      ? `${c.errorType}${c.errorMessage ? ` · ${c.errorMessage}` : ''}`
                      : '—'}
                    {c.incidentId && (
                      <Link
                        href={`/incidents/${c.incidentId}`}
                        className="ml-2 text-accent-text hover:underline"
                      >
                        incident
                      </Link>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function MonitoringPage() {
  const { orgPath } = useSession();
  const [status, setStatus] = React.useState('all');
  const [selected, setSelected] = React.useState<string | null>(null);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: useOrgKey('monitors'),
    queryFn: () => api.get<Monitor[]>(`${orgPath}/monitors`),
    refetchInterval: 15_000,
  });
  const monitors = (data ?? []).filter((m) => status === 'all' || m.status === status);
  const current = monitors.find((m) => m.id === selected) ?? monitors[0];
  const counts = Object.fromEntries(
    MONITOR_STATUSES.map((s) => [s, (data ?? []).filter((m) => m.status === s).length]),
  );

  return (
    <>
      <PageHeader
        title="Monitoring"
        description="Every HTTP monitor across your applications. Checks run in the background worker."
        actions={
          <Select
            aria-label="Filter by status"
            className="w-44"
            value={status}
            onValueChange={setStatus}
            options={[
              { value: 'all', label: `All statuses (${data?.length ?? 0})` },
              ...MONITOR_STATUSES.map((s) => ({
                value: s,
                label: `${s.charAt(0) + s.slice(1).toLowerCase()} (${counts[s] ?? 0})`,
              })),
            ]}
          />
        }
      />
      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : isPending ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : data.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No monitors yet"
          description="Monitors belong to an application. Open an application to add one."
          action={
            <Button asChild>
              <Link href="/applications">
                <Plus /> Go to applications
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            {monitors.map((m) => (
              <MonitorCard
                key={m.id}
                monitor={m}
                showApplication
                selected={current?.id === m.id}
                onShowHistory={() => setSelected(m.id)}
              />
            ))}
            {monitors.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No monitors with this status.
              </p>
            )}
          </div>
          <div className="xl:sticky xl:top-20 xl:self-start">
            {current && <CheckHistory monitor={current} />}
          </div>
        </div>
      )}
    </>
  );
}
