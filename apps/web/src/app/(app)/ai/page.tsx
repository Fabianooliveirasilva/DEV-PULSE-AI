'use client';

import { useQuery } from '@tanstack/react-query';
import { BrainCircuit, CheckCircle2, Coins, Settings2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { EmptyState, ErrorState, PageHeader, StatTile, TableSkeleton } from '@/components/page';
import { SeverityBadge } from '@/components/status';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/primitives';
import { useAiStatus } from '@/features/ai/analysis-view';
import { useOrgKey, useSession } from '@/features/session/session';
import { api, errorMessage } from '@/lib/api';
import type { AIAnalysis } from '@/lib/types';
import { formatUsd, timeAgo } from '@/lib/utils';

const STATUS_TONE = {
  COMPLETED: 'good',
  FAILED: 'critical',
  PENDING: 'info',
  RUNNING: 'info',
  NOT_CONFIGURED: 'warning',
  BUDGET_EXCEEDED: 'warning',
} as const;

export default function AiPage() {
  const { orgPath } = useSession();
  const status = useAiStatus();
  const analyses = useQuery({
    queryKey: useOrgKey('ai', 'analyses'),
    queryFn: () => api.get<AIAnalysis[]>(`${orgPath}/ai/analyses`),
    refetchInterval: 10_000,
  });
  const usage = useQuery({
    queryKey: useOrgKey('ai', 'usage'),
    queryFn: () =>
      api.get<
        { day: string; model: string; input: number; output: number; cost: number; calls: number }[]
      >(`${orgPath}/ai/usage`),
  });
  const s = status.data;
  const tokens = usage.data?.reduce((acc, u) => acc + u.input + u.output, 0) ?? 0;
  const calls = usage.data?.reduce((acc, u) => acc + u.calls, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="AI Intelligence"
        description="Error and incident analysis by Anthropic Claude, using a bounded, redacted view of your data."
      />
      {s && !s.configured && (
        <div
          className="mb-6 flex gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm"
          role="status"
          data-testid="ai-not-configured"
        >
          <Settings2 className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
          <div>
            <p className="font-medium">Configuration pending</p>
            <p className="text-muted-foreground">
              Add <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> to the API and worker
              environment and restart them. Until then, analysis requests are recorded as “not
              configured” and no results are generated.
            </p>
          </div>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Provider"
          icon={BrainCircuit}
          loading={status.isPending}
          value={s?.configured ? 'Anthropic' : 'Not configured'}
          hint={s?.configured ? 'Claude via official SDK' : undefined}
        />
        <StatTile
          label="Spent this month"
          icon={Coins}
          loading={status.isPending}
          value={s ? formatUsd(s.spentThisMonthUsd) : '—'}
          hint={s ? `of ${formatUsd(s.monthlyBudgetUsd)} budget` : undefined}
        />
        <StatTile
          label="Calls this month"
          loading={usage.isPending}
          value={calls}
          hint={`${tokens.toLocaleString()} tokens`}
        />
        <StatTile
          label="Analyses"
          loading={analyses.isPending}
          value={analyses.data?.length ?? 0}
          hint="Last 50 shown"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Analyses</CardTitle>
              <CardDescription>
                Request an analysis from an incident or an error group.
              </CardDescription>
            </div>
          </CardHeader>
          {analyses.error ? (
            <CardContent>
              <ErrorState
                message={errorMessage(analyses.error)}
                onRetry={() => analyses.refetch()}
              />
            </CardContent>
          ) : analyses.isPending ? (
            <TableSkeleton />
          ) : analyses.data.length === 0 ? (
            <CardContent>
              <EmptyState
                icon={BrainCircuit}
                title="No analyses yet"
                description="Open an incident or an error group and choose “Analyze with AI”."
              />
            </CardContent>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Subject</TH>
                  <TH>Status</TH>
                  <TH className="hidden md:table-cell">Severity</TH>
                  <TH className="hidden lg:table-cell">Requested by</TH>
                  <TH className="text-right">When</TH>
                </TR>
              </THead>
              <TBody>
                {analyses.data.map((a) => (
                  <TR key={a.id}>
                    <TD className="max-w-sm">
                      <Link
                        href={`/ai/${a.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {a.incident?.title ?? a.errorGroup?.title ?? 'Deleted item'}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {a.targetType === 'INCIDENT' ? 'Incident' : 'Error group'}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[a.status]}>
                        {a.status.toLowerCase().replace('_', ' ')}
                      </Badge>
                    </TD>
                    <TD className="hidden md:table-cell">
                      {a.severity ? <SeverityBadge severity={a.severity} /> : '—'}
                    </TD>
                    <TD className="hidden text-muted-foreground lg:table-cell">
                      {a.requestedBy?.name ?? '—'}
                    </TD>
                    <TD className="text-right whitespace-nowrap text-muted-foreground">
                      {timeAgo(a.createdAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-accent-text" aria-hidden /> Safeguards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm text-muted-foreground">
              {[
                'Only selected fields are sent: checks, timeline, and up to 25 redacted log lines.',
                'Log text is wrapped as untrusted data; instruction-like content is not obeyed.',
                'Structured output is schema-validated; evidence ids that do not exist are removed.',
                'Hypotheses are never shown as confirmed causes without cited evidence.',
                'Each call is recorded with model, prompt version, tokens and cost.',
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good-text" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
