'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, MoreHorizontal, Pause, Pencil, Play, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { toast } from 'sonner';
import { CheckStrip } from '@/components/charts';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Card, Skeleton } from '@/components/ui/primitives';
import { useOrgKey, useSession } from '@/features/session/session';
import { api } from '@/lib/api';
import type { Monitor, MonitorCheck, Page } from '@/lib/types';
import { formatMs, timeAgo } from '@/lib/utils';
import { MonitorDialog } from './monitor-form';

export function useMonitorChecks(monitorId: string, limit = 60) {
  const { orgPath } = useSession();
  return useQuery({
    queryKey: useOrgKey('monitor', monitorId, 'checks', limit),
    queryFn: () =>
      api.get<Page<MonitorCheck>>(`${orgPath}/monitors/${monitorId}/checks`, { limit }),
    refetchInterval: 15_000,
  });
}

export function MonitorCard({
  monitor,
  showApplication,
  onShowHistory,
  selected,
}: {
  monitor: Monitor;
  showApplication?: boolean;
  onShowHistory?: () => void;
  selected?: boolean;
}) {
  const { orgPath, org, can } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const checks = useMonitorChecks(monitor.id);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['org', org.id] });

  const run = useMutation({
    mutationFn: () => api.post(`${orgPath}/monitors/${monitor.id}/run`),
    onSuccess: () => {
      toast.success('Check queued');
      setTimeout(invalidate, 2500);
    },
  });
  const toggle = useMutation({
    mutationFn: () =>
      api.patch(`${orgPath}/monitors/${monitor.id}`, { isActive: !monitor.isActive }),
    onSuccess: () => {
      toast.success(monitor.isActive ? 'Monitor paused' : 'Monitor resumed');
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`${orgPath}/monitors/${monitor.id}`),
    onSuccess: () => {
      toast.success('Monitor deleted');
      invalidate();
    },
  });

  const items = checks.data?.items ?? [];
  const failed = items.filter((c) => c.result === 'DOWN').length;
  const canWrite = can('monitors:write');

  return (
    <Card className={selected ? 'p-4 ring-1 ring-primary/60' : 'p-4'} data-testid="monitor-card">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium">{monitor.name}</h3>
            <StatusBadge status={monitor.status} />
            {showApplication && monitor.application && (
              <Link
                href={`/applications/${monitor.application.id}`}
                className="text-xs text-muted-foreground hover:underline"
              >
                {monitor.application.name}
              </Link>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {monitor.method} {monitor.url}
          </p>
        </div>
        {onShowHistory && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onShowHistory}
            aria-pressed={selected}
            aria-label={`Show check history for ${monitor.name}`}
          >
            <History /> <span className="hidden sm:inline">History</span>
          </Button>
        )}
        {canWrite && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => run.mutate()}
              loading={run.isPending}
              disabled={!monitor.isActive}
              aria-label={`Run check now for ${monitor.name}`}
            >
              <RefreshCw /> <span className="hidden sm:inline">Check now</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${monitor.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil aria-hidden /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => toggle.mutate()}>
                  {monitor.isActive ? <Pause aria-hidden /> : <Play aria-hidden />}{' '}
                  {monitor.isActive ? 'Pause' : 'Resume'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-critical-text"
                  onSelect={() => {
                    if (window.confirm(`Delete monitor “${monitor.name}” and its check history?`))
                      remove.mutate();
                  }}
                >
                  <Trash2 aria-hidden /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <div className="mt-4">
        {checks.isPending ? (
          <Skeleton className="h-8" />
        ) : items.length > 0 ? (
          <CheckStrip checks={items} />
        ) : (
          <p className="flex h-8 items-center text-xs text-muted-foreground">
            Waiting for the first check…
          </p>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Last check</dt>
          <dd>{timeAgo(monitor.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last latency</dt>
          <dd className="tabular">{formatMs(monitor.lastLatencyMs)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Interval</dt>
          <dd>every {monitor.intervalSeconds}s</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Recent failures</dt>
          <dd className={failed > 0 ? 'text-critical-text' : undefined}>
            {failed} / {items.length}
          </dd>
        </div>
      </dl>
      {canWrite && (
        <MonitorDialog
          open={editing}
          onOpenChange={setEditing}
          applicationId={monitor.applicationId}
          monitor={monitor}
        />
      )}
    </Card>
  );
}
