'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { APP_ENVIRONMENTS, createApplicationSchema } from '@devpulse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { useApplications } from '@/components/filters';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/page';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import {
  Badge,
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
import type { ApplicationSummary, Project } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

type Values = z.input<typeof createApplicationSchema>;

function NewApplicationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { orgPath, org } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projects = useQuery({
    queryKey: useOrgKey('projects'),
    queryFn: () => api.get<Project[]>(`${orgPath}/projects`),
  });
  const form = useForm<Values>({
    resolver: zodResolver(createApplicationSchema),
    values: {
      projectId: projects.data?.[0]?.id ?? '',
      name: '',
      description: '',
      environment: 'PRODUCTION',
    },
  });
  const create = useMutation({
    mutationFn: (v: Values) =>
      api.post<ApplicationSummary>(`${orgPath}/applications`, {
        ...v,
        description: v.description || undefined,
      }),
    onSuccess: async (app) => {
      await queryClient.invalidateQueries({ queryKey: ['org', org.id] });
      toast.success(`${app.name} created. Add a monitor to start checking it.`);
      onOpenChange(false);
      router.push(`/applications/${app.id}`);
    },
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New application"
        description="An application groups the monitors, logs and incidents of one service."
      >
        <form
          onSubmit={form.handleSubmit((v) => create.mutate(v))}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="a-name">Name</Label>
            <Input
              id="a-name"
              placeholder="Checkout API"
              aria-invalid={!!e.name}
              {...form.register('name')}
            />
            <FieldError message={e.name?.message} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a-project">Project</Label>
              <NativeSelect id="a-project" {...form.register('projectId')}>
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
              <FieldError message={e.projectId?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-env">Environment</Label>
              <NativeSelect id="a-env" {...form.register('environment')}>
                {APP_ENVIRONMENTS.map((env) => (
                  <option key={env} value={env}>
                    {env.charAt(0) + env.slice(1).toLowerCase()}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-desc">Description</Label>
            <Textarea id="a-desc" placeholder="Optional" {...form.register('description')} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create application
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApplicationsInner() {
  const { can } = useSession();
  const params = useSearchParams();
  const [open, setOpen] = React.useState(params.get('new') === '1');
  const { data, isPending, error, refetch } = useApplications();
  const canWrite = can('apps:write');
  const addButton = canWrite ? (
    <Button onClick={() => setOpen(true)}>
      <Plus /> New application
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Applications"
        description="Services you monitor, grouped by project and environment."
        actions={addButton}
      />
      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : isPending ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : data.length === 0 ? (
        <EmptyState
          icon={AppWindow}
          title="No applications yet"
          description="Create an application, then attach monitors and an ingestion key for logs."
          action={addButton}
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Application</TH>
                <TH>Status</TH>
                <TH>Environment</TH>
                <TH className="hidden md:table-cell">Project</TH>
                <TH className="text-right">Monitors</TH>
                <TH className="text-right">Open incidents</TH>
                <TH className="hidden text-right lg:table-cell">Last check</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link href={`/applications/${a.id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    {a.description && (
                      <p className="max-w-xs truncate text-xs text-muted-foreground">
                        {a.description}
                      </p>
                    )}
                  </TD>
                  <TD>
                    <StatusBadge status={a.status} />
                  </TD>
                  <TD>
                    <Badge>{a.environment.toLowerCase()}</Badge>
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{a.project.name}</TD>
                  <TD className="text-right tabular">{a.monitorCount}</TD>
                  <TD className="text-right tabular">
                    {a.openIncidents > 0 ? (
                      <span className="font-medium text-critical-text">{a.openIncidents}</span>
                    ) : (
                      0
                    )}
                  </TD>
                  <TD className="hidden text-right text-muted-foreground lg:table-cell">
                    {timeAgo(a.lastCheckedAt)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {canWrite && <NewApplicationDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}

export default function ApplicationsPage() {
  return (
    <React.Suspense>
      <ApplicationsInner />
    </React.Suspense>
  );
}
