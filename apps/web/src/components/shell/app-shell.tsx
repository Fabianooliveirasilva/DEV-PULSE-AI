'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AppWindow,
  Bell,
  BrainCircuit,
  Building2,
  Check,
  ChevronsUpDown,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  ScrollText,
  Settings,
  Siren,
  Sun,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import * as React from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { CreateOrganizationDialog } from '@/features/settings/create-organization-dialog';
import { useOrgKey, useSession } from '@/features/session/session';
import { api } from '@/lib/api';
import type { Notification, Page } from '@/lib/types';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/applications', label: 'Applications', icon: AppWindow },
  { href: '/monitoring', label: 'Monitoring', icon: Activity },
  { href: '/incidents', label: 'Incidents', icon: Siren },
  { href: '/logs', label: 'Logs Explorer', icon: ScrollText },
  { href: '/ai', label: 'AI Intelligence', icon: BrainCircuit },
  { href: '/reliability', label: 'Reliability', icon: Gauge },
] as const;

const SECONDARY = [
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const link = (item: { href: string; label: string; icon: typeof Bell }) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
          active
            ? 'bg-surface-3 font-medium text-foreground'
            : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        )}
      >
        <Icon className={cn('size-4', active && 'text-accent-text')} aria-hidden />
        {item.label}
      </Link>
    );
  };
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5">
      {NAV.map(link)}
      <div className="my-3 h-px bg-border" />
      {SECONDARY.map(link)}
    </nav>
  );
}

function OrgSwitcher() {
  const { me, org, setOrg } = useSession();
  const [creating, setCreating] = React.useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-left text-sm hover:bg-surface-3"
            aria-label="Switch organization"
            data-testid="org-switcher"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/15 text-xs font-semibold text-accent-text">
              {org.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{org.name}</span>
              <span className="block text-[11px] text-muted-foreground capitalize">
                {org.role.toLowerCase()}
              </span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {me.organizations.map((o) => (
            <DropdownMenuItem key={o.id} onSelect={() => setOrg(o.id)}>
              <Building2 aria-hidden />
              <span className="flex-1 truncate">{o.name}</span>
              {o.id === org.id && <Check className="!text-accent-text" aria-label="current" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus aria-hidden /> New organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrganizationDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(o) => setOrg(o.id)}
      />
    </>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <Link href="/dashboard" className="px-1.5 pt-1" onClick={onNavigate}>
        <Logo />
      </Link>
      <OrgSwitcher />
      <NavLinks onNavigate={onNavigate} />
    </div>
  );
}

function NotificationBell() {
  const { orgPath } = useSession();
  const key = useOrgKey('notifications', 'unread');
  const { data } = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<Page<Notification> & { unread: number }>(`${orgPath}/notifications`, {
        unread: 'true',
        limit: 1,
      }),
    refetchInterval: 30_000,
  });
  const unread = data?.unread ?? 0;
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
    >
      <Link href="/notifications" className="relative">
        <Bell />
        {unread > 0 && (
          <span
            className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white"
            data-testid="unread-count"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme !== 'light';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

function UserMenu() {
  const { me } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex size-8 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold"
          aria-label="Account menu"
          data-testid="user-menu"
        >
          {me.name
            .split(' ')
            .map((p) => p[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium text-foreground">{me.name}</span>
          <span className="block truncate">{me.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/profile')}>
          <User aria-hidden /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/settings')}>
          <Settings aria-hidden /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout} data-testid="logout">
          <LogOut aria-hidden /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-border bg-surface lg:block">
        <SidebarBody />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-8">
          <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </Button>
            <DialogContent
              title="Navigation"
              className="top-0 left-0 h-dvh max-h-dvh w-72 max-w-72 translate-x-0 translate-y-0 rounded-none p-0"
            >
              <SidebarBody onNavigate={() => setMobileOpen(false)} />
            </DialogContent>
          </Dialog>
          <div className="lg:hidden">
            <Logo withWordmark={false} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
