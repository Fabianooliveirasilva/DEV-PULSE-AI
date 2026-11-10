'use client';

import { LOG_SEVERITIES, type LogSeverity, type TimeRange } from '@devpulse/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronRight, Layers, ScrollText, Search } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { ApplicationFilter, RangeToggle } from '@/components/filters';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/page';
import { LogSeverityBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Card, Input, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { useOrgKey, useSession } from '@/features/session/session';
import { api, errorMessage } from '@/lib/api';
import type { ErrorGroup, LogEntry, Page } from '@/lib/types';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function LogRow({ log }: { log: LogEntry }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <TR className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <TD className="w-8 pr-0">
          <button
            aria-label={open ? 'Collapse log' : 'Expand log'}
            aria-expanded={open}
            className="text-muted-foreground"
            onClick={(e) => (e.stopPropagation(), setOpen((o) => !o))}
          >
            <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
          </button>
        </TD>
        <TD className="font-mono text-xs whitespace-nowrap text-muted-foreground">
          {formatDateTime(log.timestamp)}
        </TD>
        <TD>
          <LogSeverityBadge severity={log.severity} />
        </TD>
        <TD className="hidden text-xs whitespace-nowrap text-muted-foreground md:table-cell">
          {log.application.name}
        </TD>
        <TD className="hidden text-xs text-muted-foreground lg:table-cell">{log.environment}</TD>
        <TD className="max-w-[1px] w-full">
          <p className="truncate font-mono text-xs">{log.message}</p>
        </TD>
      </TR>
      {open && (
        <tr className="border-b border-border bg-surface-2/50">
          <td colSpan={6} className="px-4 py-3">
            <pre className="font-mono text-xs whitespace-pre-wrap break-words">{log.message}</pre>
            {log.metadata && (
              <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-surface p-3 font-mono text-[11px] text-muted-foreground">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            )}
            {log.errorGroupId && (
              <Link
                href={`/logs/groups/${log.errorGroupId}`}
                className="mt-2 inline-block text-xs text-accent-text hover:underline"
              >
                Open error group →
              </Link>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Explorer() {
  const { orgPath } = useSession();
  const [q, setQ] = React.useState('');
  const [app, setApp] = React.useState('all');
  const [severities, setSeverities] = React.useState<LogSeverity[]>([]);
  const [environment, setEnvironment] = React.useState('');
  const search = useDebounced(q);
  const env = useDebounced(environment);
  const query = useInfiniteQuery({
    queryKey: useOrgKey('logs', search, app, severities, env),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Page<LogEntry>>(`${orgPath}/logs`, {
        q: search || undefined,
        applicationId: app === 'all' ? undefined : app,
        severity: severities.length ? severities : undefined,
        environment: env || undefined,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const toggle = (s: LogSeverity) =>
    setSeverities((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search
            className="pointer-events-none absolute top-2.5 left-3 size-4 text-subtle-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search messages…"
            className="pl-9"
            aria-label="Search log messages"
            maxLength={200}
          />
        </div>
        <ApplicationFilter value={app} onChange={setApp} />
        <Input
          value={environment}
          onChange={(e) => setEnvironment(e.target.value)}
          placeholder="Environment"
          className="w-36"
          aria-label="Environment"
          maxLength={32}
        />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Severity filter">
        {LOG_SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => toggle(s)}
            aria-pressed={severities.includes(s)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition-colors',
              severities.includes(s)
                ? 'border-primary bg-primary/15 text-foreground'
                : 'border-border-strong text-muted-foreground hover:text-foreground',
            )}
          >
            {s}
          </button>
        ))}
      </div>
      {query.error ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <Card>
          <TableSkeleton rows={8} />
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No logs match"
          description="Send logs with an application ingestion key (Applications → Log ingestion), or relax the filters."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH />
                <TH>Time</TH>
                <TH>Level</TH>
                <TH className="hidden md:table-cell">Application</TH>
                <TH className="hidden lg:table-cell">Env</TH>
                <TH>Message</TH>
              </TR>
            </THead>
            <TBody data-testid="log-rows">
              {items.map((l) => (
                <LogRow key={l.id} log={l} />
              ))}
            </TBody>
          </Table>
          {query.hasNextPage && (
            <div className="border-t border-border p-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => query.fetchNextPage()}
                loading={query.isFetchingNextPage}
              >
                Load older logs
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Groups() {
  const { orgPath } = useSession();
  const [range, setRange] = React.useState<TimeRange>('7d');
  const [app, setApp] = React.useState('all');
  const { data, isPending, error, refetch } = useQuery({
    queryKey: useOrgKey('error-groups', range, app),
    queryFn: () =>
      api.get<ErrorGroup[]>(`${orgPath}/error-groups`, {
        range,
        applicationId: app === 'all' ? undefined : app,
      }),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <ApplicationFilter value={app} onChange={setApp} />
        <RangeToggle value={range} onChange={setRange} />
      </div>
      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : isPending ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : data.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No error groups"
          description="ERROR and FATAL logs are grouped by message shape (ids and numbers ignored)."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Error</TH>
                <TH>Level</TH>
                <TH className="hidden md:table-cell">Application</TH>
                <TH className="text-right">Events</TH>
                <TH className="hidden text-right sm:table-cell">First seen</TH>
                <TH className="text-right">Last seen</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((g) => (
                <TR key={g.id}>
                  <TD className="max-w-md">
                    <Link
                      href={`/logs/groups/${g.id}`}
                      className="block truncate font-mono text-xs hover:underline"
                    >
                      {g.title}
                    </Link>
                    {g.errorType && (
                      <span className="text-xs text-muted-foreground">{g.errorType}</span>
                    )}
                  </TD>
                  <TD>
                    <LogSeverityBadge severity={g.severity} />
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">
                    {g.application.name}
                  </TD>
                  <TD className="text-right tabular">{g.count.toLocaleString()}</TD>
                  <TD className="hidden text-right text-muted-foreground sm:table-cell">
                    {timeAgo(g.firstSeenAt)}
                  </TD>
                  <TD className="text-right text-muted-foreground">{timeAgo(g.lastSeenAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function LogsInner() {
  const params = useSearchParams();
  return (
    <>
      <PageHeader
        title="Logs Explorer"
        description="Search ingested logs and recurring errors. Secrets are redacted at ingestion."
      />
      <Tabs defaultValue={params.get('tab') === 'groups' ? 'groups' : 'explorer'}>
        <TabsList>
          <TabsTrigger value="explorer">
            <ScrollText className="size-3.5" /> Explorer
          </TabsTrigger>
          <TabsTrigger value="groups">
            <Layers className="size-3.5" /> Error groups
          </TabsTrigger>
        </TabsList>
        <TabsContent value="explorer">
          <Explorer />
        </TabsContent>
        <TabsContent value="groups">
          <Groups />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function LogsPage() {
  return (
    <React.Suspense>
      <LogsInner />
    </React.Suspense>
  );
}
