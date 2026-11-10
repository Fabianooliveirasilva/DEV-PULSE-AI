'use client';

import {
  NOTIFICATION_TYPES,
  ORG_ROLES,
  type OrgRole,
  canManageRole,
  type NotificationType,
} from '@devpulse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Switch,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/primitives';
import { useOrgKey, useSession } from '@/features/session/session';
import { api } from '@/lib/api';
import type {
  AuditEntry,
  Member,
  NotificationChannel,
  Organization,
  Page,
  Project,
} from '@/lib/types';
import { formatDateTime } from '@/lib/utils';

const roleLabel = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();

export function GeneralPanel() {
  const { orgPath } = useSession();
  const { data } = useQuery({
    queryKey: useOrgKey('organization'),
    queryFn: () => api.get<Organization>(orgPath),
  });
  return data ? <GeneralForm key={data.id} organization={data} /> : null;
}

function GeneralForm({ organization: data }: { organization: Organization }) {
  const { orgPath, org, can } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [form, setForm] = React.useState({
    name: data.name,
    aiMonthlyBudgetUsd: String(Number(data.aiMonthlyBudgetUsd)),
    logRetentionDays: String(data.logRetentionDays),
    checkRetentionDays: String(data.checkRetentionDays),
  });
  const save = useMutation({
    mutationFn: () =>
      api.patch(orgPath, {
        name: form.name,
        aiMonthlyBudgetUsd: Number(form.aiMonthlyBudgetUsd),
        logRetentionDays: Number(form.logRetentionDays),
        checkRetentionDays: Number(form.checkRetentionDays),
      }),
    onSuccess: () => {
      toast.success('Organization updated');
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['org', org.id] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(orgPath),
    onSuccess: async () => {
      try {
        localStorage.removeItem('devpulse.org');
      } catch {
        /* ignore */
      }
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.success('Organization deleted');
      router.replace('/dashboard');
    },
  });
  const editable = can('org:update');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Organization</CardTitle>
            <CardDescription>
              Budgets and data retention apply to every application in {org.name}.
            </CardDescription>
          </div>
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
              <Label htmlFor="o-name">Name</Label>
              <Input
                id="o-name"
                value={form.name}
                onChange={set('name')}
                disabled={!editable}
                required
                minLength={2}
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-budget">Monthly AI budget (USD)</Label>
              <Input
                id="o-budget"
                type="number"
                min={0}
                max={10000}
                step="0.01"
                value={form.aiMonthlyBudgetUsd}
                onChange={set('aiMonthlyBudgetUsd')}
                disabled={!editable}
              />
              <p className="text-xs text-muted-foreground">
                Analyses are refused once this month’s spend reaches the budget.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="o-logs">Log retention (days)</Label>
                <Input
                  id="o-logs"
                  type="number"
                  min={1}
                  max={90}
                  value={form.logRetentionDays}
                  onChange={set('logRetentionDays')}
                  disabled={!editable}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="o-checks">Check retention (days)</Label>
                <Input
                  id="o-checks"
                  type="number"
                  min={1}
                  max={365}
                  value={form.checkRetentionDays}
                  onChange={set('checkRetentionDays')}
                  disabled={!editable}
                />
              </div>
            </div>
            {editable && (
              <Button type="submit" loading={save.isPending}>
                Save changes
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
      {can('org:delete') && (
        <Card className="self-start border-critical/30">
          <CardHeader>
            <CardTitle>Delete organization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Permanently deletes all applications, monitors, incidents, logs and analyses of{' '}
              {org.name}.
            </p>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                window.prompt(`Type “${org.name}” to confirm`) === org.name && remove.mutate()
              }
            >
              <Trash2 /> Delete organization
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function MembersPanel() {
  const { orgPath, org, me, can } = useSession();
  const queryClient = useQueryClient();
  const key = useOrgKey('members');
  const members = useQuery({
    queryKey: key,
    queryFn: () => api.get<Member[]>(`${orgPath}/members`),
  });
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<OrgRole>('MEMBER');
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: () => api.post(`${orgPath}/members`, { email, role }),
    onSuccess: () => {
      toast.success('Member added');
      setEmail('');
      refresh();
    },
  });
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: OrgRole }) =>
      api.patch(`${orgPath}/members/${id}`, { role }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${orgPath}/members/${id}`),
    onSuccess: (_d, id) => {
      const self = members.data?.find((m) => m.id === id)?.user.id === me.id;
      if (self) {
        queryClient.invalidateQueries({ queryKey: ['me'] });
      } else refresh();
    },
  });
  const canManage = can('members:manage');
  const grantable = ORG_ROLES.filter((r) => canManageRole(org.role, r));

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Viewer: read-only · Member: operate monitors, incidents and AI · Admin: manage members,
            keys and channels · Owner: everything.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="min-w-56 flex-1"
              aria-label="Member e-mail"
            />
            <NativeSelect
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
              className="w-36"
              aria-label="Role"
            >
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" loading={add.isPending}>
              <Plus /> Add member
            </Button>
          </form>
        )}
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH className="hidden sm:table-cell">Joined</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {members.data?.map((m) => {
              const self = m.user.id === me.id;
              const manageable = canManage && !self && canManageRole(org.role, m.role);
              return (
                <TR key={m.id}>
                  <TD>
                    <p className="font-medium">
                      {m.user.name}{' '}
                      {self && <span className="text-xs text-muted-foreground">(you)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.user.email}</p>
                  </TD>
                  <TD>
                    {manageable ? (
                      <NativeSelect
                        value={m.role}
                        onChange={(e) =>
                          changeRole.mutate({ id: m.id, role: e.target.value as OrgRole })
                        }
                        className="w-32"
                        aria-label={`Role of ${m.user.name}`}
                      >
                        {grantable.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Badge>{roleLabel(m.role)}</Badge>
                    )}
                  </TD>
                  <TD className="hidden text-muted-foreground sm:table-cell">
                    {formatDateTime(m.createdAt)}
                  </TD>
                  <TD className="text-right">
                    {(manageable || self) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-critical-text"
                        onClick={() =>
                          window.confirm(self ? `Leave ${org.name}?` : `Remove ${m.user.name}?`) &&
                          remove.mutate(m.id)
                        }
                      >
                        {self ? 'Leave' : 'Remove'}
                      </Button>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function ProjectsPanel() {
  const { orgPath, can } = useSession();
  const queryClient = useQueryClient();
  const key = useOrgKey('projects');
  const projects = useQuery({
    queryKey: key,
    queryFn: () => api.get<Project[]>(`${orgPath}/projects`),
  });
  const [name, setName] = React.useState('');
  const create = useMutation({
    mutationFn: () => api.post(`${orgPath}/projects`, { name }),
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${orgPath}/projects/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const canWrite = can('apps:write');
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Projects</CardTitle>
          <CardDescription>
            Projects group applications. A project must be empty before it can be deleted.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New project name"
              maxLength={100}
              aria-label="Project name"
            />
            <Button type="submit" loading={create.isPending}>
              <Plus /> Add
            </Button>
          </form>
        )}
        <ul className="divide-y divide-border">
          {projects.data?.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="flex-1 font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {p._count.applications} applications
              </span>
              {canWrite && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={p._count.applications > 0}
                  onClick={() => remove.mutate(p.id)}
                  aria-label={`Delete project ${p.name}`}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const typeLabel = (t: NotificationType) => t.toLowerCase().replace(/_/g, ' ');

export function ChannelsPanel() {
  const { orgPath, can } = useSession();
  const queryClient = useQueryClient();
  const key = useOrgKey('channels');
  const channels = useQuery({
    queryKey: key,
    queryFn: () => api.get<NotificationChannel[]>(`${orgPath}/notification-channels`),
  });
  const [type, setType] = React.useState<'EMAIL' | 'WEBHOOK'>('WEBHOOK');
  const [name, setName] = React.useState('');
  const [target, setTarget] = React.useState('');
  const [events, setEvents] = React.useState<NotificationType[]>([
    'MONITOR_DOWN',
    'INCIDENT_CRITICAL',
  ]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: () => api.post(`${orgPath}/notification-channels`, { type, name, target, events }),
    onSuccess: () => {
      toast.success('Channel added');
      setName('');
      setTarget('');
      refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (c: NotificationChannel) =>
      api.patch(`${orgPath}/notification-channels/${c.id}`, { isEnabled: !c.isEnabled }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${orgPath}/notification-channels/${id}`),
    onSuccess: refresh,
  });
  const canManage = can('channels:manage');

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>External channels</CardTitle>
          <CardDescription>
            In-app notifications are always on. Webhooks receive a JSON POST; e-mail requires SMTP
            configured on the worker.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {canManage && (
          <form
            className="space-y-3 rounded-md border border-border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[140px_1fr_2fr]">
              <NativeSelect
                value={type}
                onChange={(e) => setType(e.target.value as 'EMAIL' | 'WEBHOOK')}
                aria-label="Channel type"
              >
                <option value="WEBHOOK">Webhook</option>
                <option value="EMAIL">E-mail</option>
              </NativeSelect>
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                maxLength={100}
                aria-label="Channel name"
              />
              <Input
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={
                  type === 'EMAIL' ? 'oncall@company.com' : 'https://hooks.example.com/devpulse'
                }
                aria-label="Channel target"
              />
            </div>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
              <legend className="sr-only">Events</legend>
              {NOTIFICATION_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 text-xs capitalize">
                  <input
                    type="checkbox"
                    className="accent-[var(--primary)]"
                    checked={events.includes(t)}
                    onChange={() =>
                      setEvents((cur) =>
                        cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t],
                      )
                    }
                  />
                  {typeLabel(t)}
                </label>
              ))}
            </fieldset>
            <Button
              type="submit"
              size="sm"
              loading={create.isPending}
              disabled={events.length === 0}
            >
              <Plus /> Add channel
            </Button>
          </form>
        )}
        {channels.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No external channels configured.</p>
        ) : (
          <ul className="divide-y divide-border">
            {channels.data?.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <Badge>{c.type.toLowerCase()}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{c.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{c.target}</p>
                  <p className="text-xs text-subtle-foreground capitalize">
                    {c.events.map(typeLabel).join(' · ')}
                  </p>
                </div>
                {canManage && (
                  <>
                    <Switch
                      checked={c.isEnabled}
                      onCheckedChange={() => toggle.mutate(c)}
                      aria-label={`Enable ${c.name}`}
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => remove.mutate(c.id)}
                      aria-label={`Delete ${c.name}`}
                    >
                      <Trash2 />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AuditPanel() {
  const { orgPath } = useSession();
  const audit = useQuery({
    queryKey: useOrgKey('audit'),
    queryFn: () => api.get<Page<AuditEntry>>(`${orgPath}/audit-logs`),
  });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>
            Security-relevant actions in this organization. Last 50 entries.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Action</TH>
              <TH>Actor</TH>
              <TH className="hidden md:table-cell">IP</TH>
            </TR>
          </THead>
          <TBody>
            {audit.data?.items.map((a) => (
              <TR key={a.id}>
                <TD className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(a.createdAt)}
                </TD>
                <TD className="font-mono text-xs">{a.action}</TD>
                <TD>{a.actor?.name ?? 'system'}</TD>
                <TD className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                  {a.ipAddress ?? '—'}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
