'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDownCircle, Bell, CheckCheck, CheckCircle2, Flame, Siren, Timer } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Card } from '@/components/ui/primitives';
import { useOrgKey, useSession } from '@/features/session/session';
import { api, errorMessage } from '@/lib/api';
import type { Notification, Page } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

const ICON = {
  MONITOR_DOWN: { icon: ArrowDownCircle, cls: 'text-critical-text' },
  MONITOR_RECOVERED: { icon: CheckCircle2, cls: 'text-good-text' },
  ERROR_SPIKE: { icon: Flame, cls: 'text-serious-text' },
  INCIDENT_CRITICAL: { icon: Siren, cls: 'text-critical-text' },
  LATENCY_THRESHOLD: { icon: Timer, cls: 'text-warning-text' },
} as const;

export default function NotificationsPage() {
  const { orgPath, org } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<'all' | 'unread'>('all');
  const query = useInfiniteQuery({
    queryKey: useOrgKey('notifications', 'list', tab),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Page<Notification> & { unread: number }>(`${orgPath}/notifications`, {
        unread: tab === 'unread' ? 'true' : undefined,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['org', org.id, 'notifications'] });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`${orgPath}/notifications/${id}/read`),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api.post(`${orgPath}/notifications/read-all`),
    onSuccess: refresh,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = query.data?.pages[0]?.unread ?? 0;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Outages, recoveries, error spikes, critical incidents and latency alerts."
        actions={
          <Button
            variant="secondary"
            onClick={() => markAll.mutate()}
            disabled={unread === 0}
            loading={markAll.isPending}
          >
            <CheckCheck /> Mark all as read
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread ({unread})</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="mb-4 text-xs text-muted-foreground">
        E-mail and webhook delivery can be configured in{' '}
        <Link href="/settings?tab=channels" className="underline">
          Settings → Channels
        </Link>
        .
      </p>
      {query.error ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={tab === 'unread' ? 'All caught up' : 'No notifications yet'}
          description="You will be notified here when a monitor goes down or recovers, errors spike, or a critical incident opens."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border" data-testid="notification-list">
            {items.map((n) => {
              const meta = ICON[n.type];
              const Icon = meta.icon;
              return (
                <li
                  key={n.id}
                  className={cn('flex gap-3 px-5 py-4', !n.readAt && 'bg-primary/[0.04]')}
                >
                  <Icon className={cn('mt-0.5 size-4 shrink-0', meta.cls)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm', !n.readAt && 'font-medium')}>{n.title}</p>
                    <p className="text-sm text-muted-foreground">{n.body}</p>
                    <div className="mt-1 flex gap-3 text-xs text-subtle-foreground">
                      <span>{timeAgo(n.createdAt)}</span>
                      {n.incidentId && (
                        <Link
                          href={`/incidents/${n.incidentId}`}
                          className="text-accent-text hover:underline"
                        >
                          View incident
                        </Link>
                      )}
                    </div>
                  </div>
                  {!n.readAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => markRead.mutate(n.id)}
                      aria-label={`Mark “${n.title}” as read`}
                    >
                      Mark read
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {query.hasNextPage && (
            <div className="border-t border-border p-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => query.fetchNextPage()}
                loading={query.isFetchingNextPage}
              >
                Load more
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
