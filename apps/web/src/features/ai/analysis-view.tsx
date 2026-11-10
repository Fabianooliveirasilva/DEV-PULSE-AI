'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  CircleHelp,
  Info,
  Loader2,
  Settings2,
  Sparkles,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { SeverityBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/primitives';
import { useOrgKey, useSession } from '@/features/session/session';
import { api } from '@/lib/api';
import type { AIAnalysis, AiStatus } from '@/lib/types';
import { formatUsd, timeAgo } from '@/lib/utils';

const IN_FLIGHT = new Set(['PENDING', 'RUNNING']);

export function useAiStatus() {
  const { orgPath } = useSession();
  return useQuery({
    queryKey: useOrgKey('ai', 'status'),
    queryFn: () => api.get<AiStatus>(`${orgPath}/ai/status`),
  });
}

/** Polls an analysis while it is pending/running. */
export function useAnalysis(id: string | undefined) {
  const { orgPath } = useSession();
  return useQuery({
    queryKey: useOrgKey('ai', 'analysis', id),
    queryFn: () => api.get<AIAnalysis>(`${orgPath}/ai/analyses/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && IN_FLIGHT.has(q.state.data.status) ? 2500 : false),
  });
}

/** Panel embedded in incidents and error groups: request + latest analysis. */
export function AnalysisPanel({
  targetType,
  targetId,
  latest,
}: {
  targetType: 'INCIDENT' | 'ERROR_GROUP';
  targetId: string;
  latest?: AIAnalysis;
}) {
  const { orgPath, org, can } = useSession();
  const queryClient = useQueryClient();
  const status = useAiStatus();
  const analysis = useAnalysis(latest?.id);
  const current = analysis.data ?? latest;
  const request = useMutation({
    mutationFn: () => api.post<AIAnalysis>(`${orgPath}/ai/analyses`, { targetType, targetId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['org', org.id] });
    },
  });
  const running = current && IN_FLIGHT.has(current.status);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="size-4 text-accent-text" aria-hidden /> AI analysis
          </CardTitle>
          <CardDescription>
            Hypotheses based on recorded checks, events and logs. Review them before acting.
          </CardDescription>
        </div>
        {can('ai:analyze') && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => request.mutate()}
            loading={request.isPending || Boolean(running)}
            data-testid="request-analysis"
          >
            <Sparkles /> {current ? 'Analyze again' : 'Analyze with AI'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {status.data && !status.data.configured && !current && <NotConfigured />}
        {current ? (
          <AnalysisBody analysis={current} />
        ) : status.data?.configured ? (
          <p className="text-sm text-muted-foreground">No analysis yet.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NotConfigured() {
  return (
    <div
      className="flex gap-3 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm"
      role="status"
      data-testid="ai-not-configured"
    >
      <Settings2 className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
      <div>
        <p className="font-medium">AI analysis is not configured</p>
        <p className="text-muted-foreground">
          Set <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> for the API and worker to
          enable it. No analysis is run or simulated until then.
        </p>
      </div>
    </div>
  );
}

export function AnalysisBody({ analysis }: { analysis: AIAnalysis }) {
  if (analysis.status === 'NOT_CONFIGURED') return <NotConfigured />;
  if (analysis.status === 'BUDGET_EXCEEDED') {
    return (
      <div
        className="flex gap-3 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm"
        role="status"
      >
        <Wallet className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
        <div>
          <p className="font-medium">Monthly AI budget reached</p>
          <p className="text-muted-foreground">
            An admin can raise it in{' '}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }
  if (analysis.status === 'PENDING' || analysis.status === 'RUNNING') {
    return (
      <div
        className="flex items-center gap-2 text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />{' '}
        {analysis.status === 'PENDING' ? 'Queued…' : 'Analyzing recorded evidence…'}
        {analysis.errorMessage && <span className="text-xs">({analysis.errorMessage})</span>}
      </div>
    );
  }
  if (analysis.status === 'FAILED' || !analysis.result) {
    return (
      <div
        className="flex gap-3 rounded-md border border-critical/30 bg-critical/5 p-3 text-sm"
        role="alert"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical-text" aria-hidden />
        <div>
          <p className="font-medium">The analysis did not complete</p>
          <p className="text-muted-foreground">
            {analysis.errorMessage ?? 'Unknown error'}. No conclusions were produced.
          </p>
        </div>
      </div>
    );
  }
  const r = analysis.result;
  const cost = analysis.usageRecords?.reduce((acc, u) => acc + Number(u.costUsd), 0);
  return (
    <div className="space-y-5 text-sm" data-testid="analysis-result">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={r.severity} />
        <Badge>{r.errorCategory.toLowerCase().replace(/_/g, ' ')}</Badge>
        <span className="text-xs text-subtle-foreground">
          {analysis.model} · {analysis.promptVersion} · {timeAgo(analysis.completedAt)}
          {cost !== undefined && ` · ${formatUsd(cost)}`}
        </span>
      </div>
      <div>
        <p className="font-medium">{r.summary}</p>
        <p className="mt-1.5 leading-relaxed text-muted-foreground">{r.explanation}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Severity rationale: {r.severityRationale}
        </p>
      </div>

      <section>
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Possible causes
        </h4>
        <ul className="space-y-2">
          {r.hypotheses.map((h, i) => {
            const supported = h.status === 'SUPPORTED_BY_EVIDENCE';
            return (
              <li
                key={i}
                className={
                  supported
                    ? 'rounded-md border border-good/30 bg-good/5 p-3'
                    : 'rounded-md border border-border-strong p-3'
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  {supported ? (
                    <CheckCircle2 className="size-4 text-good-text" aria-hidden />
                  ) : (
                    <CircleHelp className="size-4 text-muted-foreground" aria-hidden />
                  )}
                  <span className="text-xs font-medium">
                    {supported ? 'Supported by evidence' : 'Hypothesis — not confirmed'}
                  </span>
                  <span className="text-xs text-muted-foreground">· {h.confidence} confidence</span>
                </div>
                <p className="mt-1.5">{h.cause}</p>
                {h.evidence.length > 0 && (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    evidence: {h.evidence.join(', ')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {r.suggestedFixes.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Suggested next steps
          </h4>
          <ol className="space-y-3">
            {r.suggestedFixes.map((f, i) => (
              <li key={i}>
                <div className="flex items-center gap-2 font-medium">
                  {f.title}{' '}
                  <Badge
                    tone={
                      f.risk === 'high' ? 'critical' : f.risk === 'medium' ? 'warning' : 'neutral'
                    }
                  >
                    {f.risk} risk
                  </Badge>
                </div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {f.steps.map((s, j) => (
                    <li key={j}>{s}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}

      {r.preventiveActions.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Prevention
          </h4>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {r.preventiveActions.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {r.missingInformation.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Missing information
          </h4>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {r.missingInformation.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {r.validationNotes && r.validationNotes.length > 0 && (
        <div className="flex gap-2 rounded-md border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium text-foreground">Automatic validation adjusted this output</p>
            <ul className="mt-1 list-disc pl-4">
              {r.validationNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
