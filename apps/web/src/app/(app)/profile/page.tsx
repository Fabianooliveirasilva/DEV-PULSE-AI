'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema } from '@devpulse/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldError,
  Input,
  Label,
} from '@/components/ui/primitives';
import { useSession } from '@/features/session/session';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

type PasswordValues = z.input<typeof changePasswordSchema>;

export default function ProfilePage() {
  const { me } = useSession();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(me.name);
  const saveName = useMutation({
    mutationFn: () => api.patch('/auth/me', { name }),
    onSuccess: () => {
      toast.success('Profile updated');
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const form = useForm<PasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const changePassword = useMutation({
    mutationFn: (v: PasswordValues) => api.post('/auth/change-password', v),
    onSuccess: () => {
      toast.success('Password changed. Other sessions were signed out.');
      form.reset();
    },
  });
  const e = form.formState.errors;

  return (
    <>
      <PageHeader title="Profile" description="Your personal account settings." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Account</CardTitle>
              <CardDescription>Member since {formatDateTime(me.createdAt)}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                saveName.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="p-name">Name</Label>
                <Input
                  id="p-name"
                  value={name}
                  onChange={(ev) => setName(ev.target.value)}
                  required
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-email">E-mail</Label>
                <Input id="p-email" value={me.email} disabled />
              </div>
              <Button
                type="submit"
                loading={saveName.isPending}
                disabled={!name.trim() || name === me.name}
              >
                Save
              </Button>
            </form>
            <div className="mt-6">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Organizations</p>
              <ul className="space-y-1.5">
                {me.organizations.map((o) => (
                  <li key={o.id} className="flex items-center justify-between text-sm">
                    {o.name} <Badge>{o.role.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <div>
              <CardTitle>Change password</CardTitle>
              <CardDescription>
                All your other sessions are signed out after a change.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={form.handleSubmit((v) => changePassword.mutate(v))}
              className="space-y-4"
              noValidate
            >
              <div className="space-y-1.5">
                <Label htmlFor="cp-current">Current password</Label>
                <Input
                  id="cp-current"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={!!e.currentPassword}
                  {...form.register('currentPassword')}
                />
                <FieldError message={e.currentPassword?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-new">New password</Label>
                <Input
                  id="cp-new"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={!!e.newPassword}
                  {...form.register('newPassword')}
                />
                <FieldError message={e.newPassword?.message} />
              </div>
              <Button type="submit" loading={changePassword.isPending}>
                Change password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
