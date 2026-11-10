'use client';

import type { IncidentStatus, Severity } from '@devpulse/shared';
import { SEVERITIES } from '@devpulse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { CheckStrip } from '@/components/charts';
import { ErrorState } from '@/components/page';
import { IncidentStatusBadge, incidentStatusLabel, SeverityBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  NativeSelect,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';
import { AnalysisPanel } from '@/features/ai/analysis-view';
import { useOrgKey, useSession } from '@/features/session/session';
import { api, errorMessage } from '@/lib/api';
import type { IncidentDetail, Member } from '@/lib/types';
import { formatDateTime, formatDuration, formatMs } from '@/lib/utils';

interface Report {
  durationMs: number;
  impact: { failedChecks: number; errorTypes: string[] };
  timeline: { at: string; type: string; message: string; actor: string }[];
  aiAnalysis: { summary: string | null; model: string | null; promptVersion: string } | null;
}

function ReportDialog({ incident }: { incident: IncidentDetail }) {
  const { orgPath } = useSession();
  const [open, setOpen] = React.useState(false);
  const report = useQuery({
    queryKey: useOrgKey('incident', incident.id, 'report'),
    queryFn: () => api.get<Report>(`${orgPath}/incidents/${incident.id}/report`),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <FileText /> Report
      </Button>
      <DialogContent
        title={`Incident report: ${incident.title}`}
        description="Built from recorded facts. AI content is labelled."
        className="max-w-2xl"
      >
        {!report.data ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Severity</dt>
                <dd>{incident.severity}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd>{incidentStatusLabel(incident.status)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Duration</dt>
                <dd>{formatDuration(report.data.durationMs)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Failed checks</dt>
                <dd>{report.data.impact.failedChecks}</dd>
              </div>
            </dl>
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                Probable cause (team)
              </h4>
              <p>{incident.probableCause ?? 'Not recorded.'}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase">Resolution</h4>
              <p>{incident.resolutionNote ?? 'Not recorded.'}</p>
            </div>
            {report.data.aiAnalysis && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                  AI summary (hypotheses)
                </h4>
                <p>{report.data.aiAnalysis.summary}</p>
              </div>
            )}
            <div>
              <h4 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                Timeline
              </h4>
              <ol className="space-y-1">
                {report.data.timeline.map((t, i) => (
                  <li key={i} className="grid grid-cols-[150px_1fr] gap-2">
                    <span className="text-xs text-muted-foreground">{formatDateTime(t.at)}</span>
                    <span>
                      {t.message} <span className="text-xs text-muted-foreground">({t.actor})</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              Print / save as PDF
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function IncidentDetailPage() {
  const { incidentId } = useParams<{ incidentId: string }>();
  const { orgPath, org, can } = useSession();
  const queryClient = useQueryClient();
  const key = useOrgKey('incident', incidentId);
  const {
    data: incident,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: key,
    queryFn: () => api.get<IncidentDetail>(`${orgPath}/incidents/${incidentId}`),
    refetchInterval: 15_000,
  });
  const members = useQuery({
    queryKey: useOrgKey('members'),
    queryFn: () => api.get<Member[]>(`${orgPath}/members`),
  });
  const [comment, setComment] = React.useState('');
  const [cause, setCause] = React.useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = React.useState('');

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<IncidentDetail>(`${orgPath}/incidents/${incidentId}`, body),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      queryClient.invalidateQueries({ queryKey: ['org', org.id] });
      toast.success('Incident updated');
    },
  });
  const addComment = useMutation({
    mutationFn: () => api.post(`${orgPath}/incidents/${incidentId}/comments`, { message: comment }),
    onSuccess: () => {
      setComment('');
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;
  if (isPending) return <Skeleton className="h-96" />;

  const canWrite = can('incidents:write');
  const durationMs =
    (incident.resolvedAt ? new Date(incident.resolvedAt) : new Date()).getTime() -
    new Date(incident.openedAt).getTime();

  return (
    <>
      <Link
        href="/incidents"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Incidents
      </Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SeverityBadge severity={incident.severity} />
            <IncidentStatusBadge status={incident.status} />
            <Badge>{incident.source === 'MANUAL' ? 'declared' : 'automatic'}</Badge>
          </div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="incident-title">
            {incident.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/applications/${incident.application.id}`} className="hover:underline">
              {incident.application.name}
            </Link>{' '}
            · opened {formatDateTime(incident.openedAt)} ·{' '}
            {incident.resolvedAt
              ? `resolved after ${formatDuration(durationMs)}`
              : `ongoing for ${formatDuration(durationMs)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ReportDialog incident={incident} />
          {canWrite &&
            incident.allowedTransitions.map((s: IncidentStatus) => (
              <Button
                key={s}
                size="sm"
                variant={s === 'RESOLVED' ? 'primary' : 'secondary'}
                onClick={() =>
                  update.mutate({
                    status: s,
                    ...(s === 'RESOLVED' && resolutionNote ? { resolutionNote } : {}),
                  })
                }
                loading={update.isPending && update.variables?.status === s}
                data-testid={`transition-${s}`}
              >
                {s === 'OPEN' ? 'Reopen' : `Mark ${incidentStatusLabel(s).toLowerCase()}`}
              </Button>
            ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {incident.checks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Linked checks</CardTitle>
                {incident.monitor && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {incident.monitor.method} {incident.monitor.url}
                  </span>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <CheckStrip checks={incident.checks} />
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {incident.checks.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      {formatDateTime(c.checkedAt)} · {c.result} · HTTP {c.statusCode ?? '—'} ·{' '}
                      {formatMs(c.latencyMs)} {c.errorType && `· ${c.errorType}`}{' '}
                      {c.errorMessage && `· ${c.errorMessage}`}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <AnalysisPanel
            targetType="INCIDENT"
            targetId={incident.id}
            latest={incident.aiAnalyses[0]}
          />

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-5 border-l border-border pl-5" data-testid="timeline">
                {incident.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span
                      className={`absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface ${e.type === 'COMMENT' ? 'bg-primary' : e.type === 'RECOVERED' ? 'bg-good' : e.type === 'AI_ANALYSIS' ? 'bg-[var(--series-1)]' : 'bg-subtle-foreground'}`}
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {e.actor?.name ?? 'DevPulse'}
                      </span>
                      <span>{e.type.toLowerCase().replace(/_/g, ' ')}</span>
                      <span>· {formatDateTime(e.createdAt)}</span>
                    </div>
                    <p
                      className={`mt-1 text-sm ${e.type === 'COMMENT' ? 'rounded-md border border-border bg-surface-2 p-3' : ''}`}
                    >
                      {e.message}
                    </p>
                  </li>
                ))}
              </ol>
              {canWrite && (
                <form
                  className="mt-6 space-y-2"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    if (comment.trim()) addComment.mutate();
                  }}
                >
                  <Label htmlFor="comment" className="sr-only">
                    Add a comment
                  </Label>
                  <Textarea
                    id="comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Share an update with your team…"
                    maxLength={4000}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      size="sm"
                      loading={addComment.isPending}
                      disabled={!comment.trim()}
                    >
                      <MessageSquare /> Comment
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="assignee">Assignee</Label>
                <NativeSelect
                  id="assignee"
                  disabled={!canWrite}
                  value={incident.assignee?.id ?? ''}
                  onChange={(e) => update.mutate({ assigneeId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {members.data?.map((m) => (
                    <option key={m.user.id} value={m.user.id}>
                      {m.user.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="severity">Severity</Label>
                <NativeSelect
                  id="severity"
                  disabled={!canWrite}
                  value={incident.severity}
                  onChange={(e) => update.mutate({ severity: e.target.value as Severity })}
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cause">Probable cause</Label>
                <Textarea
                  id="cause"
                  disabled={!canWrite}
                  value={cause ?? incident.probableCause ?? ''}
                  onChange={(e) => setCause(e.target.value)}
                  placeholder="What the team believes caused this"
                  maxLength={2000}
                />
                {canWrite && cause !== null && cause !== (incident.probableCause ?? '') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      update.mutate(
                        { probableCause: cause || null },
                        { onSuccess: () => setCause(null) },
                      )
                    }
                  >
                    Save cause
                  </Button>
                )}
              </div>
              {canWrite && incident.status !== 'RESOLVED' && (
                <div className="space-y-1.5">
                  <Label htmlFor="resolution">Resolution note</Label>
                  <Textarea
                    id="resolution"
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    placeholder="Saved when you mark the incident resolved"
                    maxLength={2000}
                  />
                </div>
              )}
              {incident.resolutionNote && (
                <div>
                  <p className="text-xs text-muted-foreground">Resolution</p>
                  <p className="text-sm">{incident.resolutionNote}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
