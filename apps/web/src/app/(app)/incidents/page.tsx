'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createIncidentSchema, SEVERITIES } from '@devpulse/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Siren } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ApplicationFilter, useApplications } from '@/components/filters';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/page';
import { IncidentStatusBadge, SeverityBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, Tabs, TabsList, TabsTrigger } from '@/components/ui/overlays';
import {
  Card,
  FieldError,
  Input,
  Label,
  NativeSelect,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
} from '@/components/ui/primitives';
import { useOrgKey, useSession } from '@/features/session/session';
import { api, errorMessage } from '@/lib/api';
import type { IncidentSummary, Page } from '@/lib/types';
import { formatDuration, timeAgo } from '@/lib/utils';

type Values = z.input<typeof createIncidentSchema>;

function DeclareIncidentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { orgPath, org } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const apps = useApplications();
  const form = useForm<Values>({
    resolver: zodResolver(createIncidentSchema),
    values: {
      applicationId: apps.data?.[0]?.id ?? '',
      title: '',
      severity: 'HIGH',
      probableCause: '',
    },
  });
  const create = useMutation({
    mutationFn: (v: Values) =>
      api.post<IncidentSummary>(`${orgPath}/incidents`, {
        ...v,
        probableCause: v.probableCause || undefined,
      }),
    onSuccess: async (incident) => {
      await queryClient.invalidateQueries({ queryKey: ['org', org.id] });
      onOpenChange(false);
      router.push(`/incidents/${incident.id}`);
    },
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Declare incident"
        description="For problems monitors cannot see: a broken flow, a bad deploy, a data issue."
      >
        <form
          onSubmit={form.handleSubmit((v) => create.mutate(v))}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="i-title">Title</Label>
            <Input
              id="i-title"
              placeholder="Checkout fails for EU customers"
              aria-invalid={!!e.title}
              {...form.register('title')}
            />
            <FieldError message={e.title?.message} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="i-app">Application</Label>
              <NativeSelect id="i-app" {...form.register('applicationId')}>
                {apps.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
              <FieldError message={e.applicationId?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-sev">Severity</Label>
              <NativeSelect id="i-sev" {...form.register('severity')}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-cause">What do you know so far?</Label>
            <Textarea id="i-cause" placeholder="Optional" {...form.register('probableCause')} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!apps.data?.length}>
              Declare incident
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function IncidentsPage() {
  const { orgPath, can } = useSession();
  const [tab, setTab] = React.useState<'active' | 'resolved' | 'all'>('active');
  const [app, setApp] = React.useState('all');
  const [declaring, setDeclaring] = React.useState(false);
  const query = useInfiniteQuery({
    queryKey: useOrgKey('incidents', tab, app),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Page<IncidentSummary>>(`${orgPath}/incidents`, {
        active: tab === 'all' ? undefined : String(tab === 'active'),
        applicationId: app === 'all' ? undefined : app,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 20_000,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title="Incidents"
        description="Opened automatically from failing monitors, or declared by your team."
        actions={
          can('incidents:write') && (
            <Button onClick={() => setDeclaring(true)}>
              <Plus /> Declare incident
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <ApplicationFilter value={app} onChange={setApp} />
      </div>
      {query.error ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Siren}
          title={tab === 'active' ? 'No active incidents' : 'No incidents'}
          description={
            tab === 'active'
              ? 'Everything is calm. Incidents open when monitors cross their failure threshold.'
              : 'Nothing matches these filters.'
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Incident</TH>
                <TH>Severity</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Application</TH>
                <TH className="hidden lg:table-cell">Assignee</TH>
                <TH className="text-right">Duration</TH>
                <TH className="text-right">Opened</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((i) => (
                <TR key={i.id}>
                  <TD className="max-w-sm">
                    <Link href={`/incidents/${i.id}`} className="font-medium hover:underline">
                      {i.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {i.source === 'MANUAL' ? 'Declared manually' : 'Opened by monitor'}
                    </p>
                  </TD>
                  <TD>
                    <SeverityBadge severity={i.severity} />
                  </TD>
                  <TD>
                    <IncidentStatusBadge status={i.status} />
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">
                    {i.application?.name}
                  </TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">
                    {i.assignee?.name ?? 'Unassigned'}
                  </TD>
                  <TD className="text-right tabular text-muted-foreground">
                    {formatDuration(
                      (i.resolvedAt ? new Date(i.resolvedAt) : new Date()).getTime() -
                        new Date(i.openedAt).getTime(),
                    )}
                  </TD>
                  <TD className="text-right whitespace-nowrap text-muted-foreground">
                    {timeAgo(i.openedAt)}
                  </TD>
                </TR>
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
                Load more
              </Button>
            </div>
          )}
        </Card>
      )}
      {can('incidents:write') && (
        <DeclareIncidentDialog open={declaring} onOpenChange={setDeclaring} />
      )}
    </>
  );
}
