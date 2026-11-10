'use client';

import { Building2 } from 'lucide-react';
import * as React from 'react';
import { EmptyState } from '@/components/page';
import { AppShell } from '@/components/shell/app-shell';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { SessionProvider } from '@/features/session/session';
import { CreateOrganizationDialog } from '@/features/settings/create-organization-dialog';

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy aria-label="Loading">
      <div className="hidden w-60 border-r border-border bg-surface p-3 lg:block">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-6 h-11 w-full" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </div>
      <div className="flex-1 p-8">
        <Skeleton className="h-7 w-48" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    </div>
  );
}

function NoOrganization() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <Logo />
      <EmptyState
        className="w-full max-w-md bg-surface"
        icon={Building2}
        title="You are not part of an organization"
        description="Create one to start monitoring, or ask an admin to add your account to theirs."
        action={<Button onClick={() => setOpen(true)}>Create organization</Button>}
      />
      <CreateOrganizationDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<ShellSkeleton />} noOrganization={() => <NoOrganization />}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
