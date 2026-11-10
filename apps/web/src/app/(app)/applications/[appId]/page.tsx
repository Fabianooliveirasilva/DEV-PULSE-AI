'use client';

import { APP_ENVIRONMENTS, type TimeRange } from '@devpulse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, Plus, Siren, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { RangeToggle } from '@/components/filters';
import { EmptyState, ErrorState, PageHeader, StatTile } from '@/components/page';
import { IncidentStatusBadge, SeverityBadge, StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';
import { ApiKeysPanel } from '@/features/applications/api-keys';
import { MonitorCard } from '@/features/monitors/monitor-card';
import { MonitorDialog } from '@/features/monitors/monitor-form';
import { useOrgKey, useSession } from '@/features/session/session';
import { api, errorMessage } from '@/lib/api';
import type { ApplicationDetail } from '@/lib/types';
import { formatPercent, timeAgo } from '@/lib/utils';

function SettingsPanel({ app }: { app: ApplicationDetail }) {
  const { orgPath, org, can } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(app.name);
  const [description, setDescription] = React.useState(app.description ?? '');
  const [environment, setEnvironment] = React.useState(app.environment);
  const save = useMutation({
    mutationFn: () =>
      api.patch(`${orgPath}/applications/${app.id}`, { name, description, environment }),
    onSuccess: () => {
      toast.success('Application updated');
      queryClient.invalidateQueries({ queryKey: ['org', org.id] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`${orgPath}/applications/${app.id}`),
    onSuccess: async () => {
      toast.success('Application deleted');
      await queryClient.invalidateQueries({ queryKey: ['org', org.id] });
      router.replace('/applications');
    },
  });
  if (!can('apps:write'))
    return (
      <p className="text-sm text-muted-foreground">
        You have read-only access to this application.
      </p>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Name</Label>
              <Input
                id="s-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-env">Environment</Label>
              <NativeSelect
                id="s-env"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as typeof environment)}
              >
                {APP_ENVIRONMENTS.map((env) => (
                  <option key={env} value={env}>
                    {env.charAt(0) + env.slice(1).toLowerCase()}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                Determines the severity of automatic outage incidents (production = critical).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-desc">Description</Label>
              <Textarea
                id="s-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
              />
            </div>
            <Button type="submit" loading={save.isPending}>
              Save changes
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card className="border-critical/30">
        <CardHeader>
          <CardTitle>Delete application</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Deletes its monitors, check history, logs, incidents and ingestion keys. This cannot be
            undone.
          </p>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() =>
              window.confirm(`Delete ${app.name} and all its data?`) && remove.mutate()
            }
          >
            <Trash2 /> Delete application
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ApplicationDetailPage() {
  const { appId } = useParams<{ appId: string }>();
  const { orgPath, can } = useSession();
  const [range, setRange] = React.useState<TimeRange>('24h');
  const [newMonitor, setNewMonitor] = React.useState(false);
  const {
    data: app,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: useOrgKey('application', appId, range),
    queryFn: () => api.get<ApplicationDetail>(`${orgPath}/applications/${appId}`, { range }),
    refetchInterval: 15_000,
  });

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;
  if (isPending) return <Skeleton className="h-64" />;

  const addMonitor = can('monitors:write') ? (
    <Button onClick={() => setNewMonitor(true)}>
      <Plus /> Add monitor
    </Button>
  ) : null;

  return (
    <>
      <Link
        href="/applications"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Applications
      </Link>
      <PageHeader
        title={app.name}
        description={app.description ?? `${app.project.name} project`}
        actions={
          <>
            <StatusBadge status={app.status} />
            <Badge>{app.environment.toLowerCase()}</Badge>
            <RangeToggle value={range} onChange={setRange} />
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile
          label={`Uptime · ${range}`}
          value={<span data-testid="app-uptime">{formatPercent(app.uptime)}</span>}
          hint={`${app.checkCount} checks`}
        />
        <StatTile
          label="Monitors"
          value={app.monitors.length}
          hint={`${app.monitors.filter((m) => m.status === 'DOWN').length} down`}
        />
        <StatTile
          label="Open incidents"
          value={app.incidents.filter((i) => i.status !== 'RESOLVED').length}
          hint={`${app.incidents.length} recent`}
        />
      </div>
      <Tabs defaultValue="monitors">
        <TabsList>
          <TabsTrigger value="monitors">Monitors</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
          <TabsTrigger value="keys">Log ingestion</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="monitors" className="space-y-3">
          {app.monitors.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No monitors"
              description="A monitor requests a URL on a schedule and records status code and latency."
              action={addMonitor}
            />
          ) : (
            <>
              <div className="flex justify-end">{addMonitor}</div>
              {app.monitors.map((m) => (
                <MonitorCard key={m.id} monitor={m} />
              ))}
            </>
          )}
        </TabsContent>
        <TabsContent value="incidents">
          {app.incidents.length === 0 ? (
            <EmptyState
              icon={Siren}
              title="No incidents"
              description="Incidents opened for this application will appear here."
            />
          ) : (
            <Card>
              <ul className="divide-y divide-border">
                {app.incidents.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Link
                      href={`/incidents/${i.id}`}
                      className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                    >
                      {i.title}
                    </Link>
                    <SeverityBadge severity={i.severity} />
                    <IncidentStatusBadge status={i.status} />
                    <span className="w-24 text-right text-xs text-muted-foreground">
                      {timeAgo(i.openedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="keys">
          <ApiKeysPanel applicationId={app.id} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsPanel app={app} />
        </TabsContent>
      </Tabs>
      {can('monitors:write') && (
        <MonitorDialog open={newMonitor} onOpenChange={setNewMonitor} applicationId={app.id} />
      )}
    </>
  );
}
