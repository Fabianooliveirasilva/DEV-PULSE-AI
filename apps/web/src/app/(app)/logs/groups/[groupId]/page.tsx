'use client';

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorState, StatTile } from '@/components/page';
import { LogSeverityBadge } from '@/components/status';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui/primitives';
import { AnalysisPanel } from '@/features/ai/analysis-view';
import { useOrgKey, useSession } from '@/features/session/session';
import { api, errorMessage } from '@/lib/api';
import type { ErrorGroupDetail } from '@/lib/types';
import { formatDateTime, timeAgo } from '@/lib/utils';

export default function ErrorGroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { orgPath } = useSession();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: useOrgKey('error-group', groupId),
    queryFn: () => api.get<ErrorGroupDetail>(`${orgPath}/error-groups/${groupId}`),
  });
  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;
  if (isPending) return <Skeleton className="h-96" />;
  const hourly = [...data.hourly].reverse();

  return (
    <>
      <Link
        href="/logs?tab=groups"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Error groups
      </Link>
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <LogSeverityBadge severity={data.severity} />
          {data.errorType && (
            <span className="text-sm text-muted-foreground">{data.errorType}</span>
          )}
        </div>
        <h1 className="font-mono text-base font-medium break-words">{data.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href={`/applications/${data.application.id}`} className="hover:underline">
            {data.application.name}
          </Link>
        </p>
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatTile label="Events" value={data.count.toLocaleString()} />
        <StatTile
          label="First seen"
          value={timeAgo(data.firstSeenAt)}
          hint={formatDateTime(data.firstSeenAt)}
        />
        <StatTile
          label="Last seen"
          value={timeAgo(data.lastSeenAt)}
          hint={formatDateTime(data.lastSeenAt)}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Occurrences per hour</CardTitle>
                <CardDescription>Last 48 hours</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {hourly.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No occurrences in the last 48 hours.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={hourly} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tickFormatter={(v: string) => format(new Date(v), 'HH:mm')}
                      stroke="var(--chart-axis)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="var(--chart-axis)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--chart-grid)' }}
                      content={({ active, payload }) => {
                        const p = payload?.[0]?.payload as
                          { hour: string; count: number } | undefined;
                        if (!active || !p) return null;
                        return (
                          <div className="rounded-md border border-border-strong bg-surface px-3 py-2 text-xs shadow-lg">
                            <div className="font-medium">
                              {format(new Date(p.hour), 'MMM d, HH:00')}
                            </div>
                            <div className="text-muted-foreground">{p.count} events</div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill="var(--series-1)"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent samples</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.logs.map((l) => (
                <div key={l.id} className="rounded-md border border-border bg-surface-2 p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    {formatDateTime(l.timestamp)} · {l.environment}
                  </div>
                  <pre className="font-mono text-xs whitespace-pre-wrap break-words">
                    {l.message}
                  </pre>
                  {l.metadata && (
                    <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(l.metadata)}
                    </pre>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <AnalysisPanel targetType="ERROR_GROUP" targetId={data.id} latest={data.aiAnalyses[0]} />
      </div>
    </>
  );
}
