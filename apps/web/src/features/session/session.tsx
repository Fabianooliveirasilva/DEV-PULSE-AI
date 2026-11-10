'use client';

import { hasPermission, type OrgRole, type Permission } from '@devpulse/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { api, ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';

const ORG_KEY = 'devpulse.org';

interface SessionValue {
  me: Me;
  org: { id: string; name: string; slug: string; role: OrgRole };
  setOrg: (id: string) => void;
  can: (permission: Permission) => boolean;
  /** Prefix for org-scoped API paths: `/orgs/:id`. */
  orgPath: string;
}

const SessionContext = React.createContext<SessionValue | null>(null);

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
    staleTime: 60_000,
  });
}

function readStoredOrg() {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

/**
 * Gate for the authenticated app: resolves the user and the active organisation.
 * Server-side, proxy.ts already redirects requests without a session cookie; this
 * handles expired sessions and org selection.
 */
export function SessionProvider({
  children,
  fallback,
  noOrganization,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
  noOrganization: (me: Me) => React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data: me, error, isPending } = useMe();
  // Lazy init is hydration-safe here: the first render on both server and client is the
  // loading fallback (the /auth/me query has not resolved yet).
  const [orgId, setOrgId] = React.useState<string | null>(() =>
    typeof window === 'undefined' ? null : readStoredOrg(),
  );

  React.useEffect(() => {
    if (error instanceof ApiError && error.status === 401)
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [error, pathname, router]);

  const setOrg = React.useCallback(
    (id: string) => {
      try {
        localStorage.setItem(ORG_KEY, id);
      } catch {
        /* storage unavailable: selection lasts for this tab only */
      }
      setOrgId(id);
      // Org-scoped caches must not leak across organisations.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === 'org' });
    },
    [queryClient],
  );

  const value = React.useMemo<SessionValue | null>(() => {
    if (!me || me.organizations.length === 0) return null;
    const org = me.organizations.find((o) => o.id === orgId) ?? me.organizations[0]!;
    return { me, org, setOrg, can: (p) => hasPermission(org.role, p), orgPath: `/orgs/${org.id}` };
  }, [me, orgId, setOrg]);

  if (isPending || (error && !(error instanceof ApiError && error.status === 401))) {
    if (error) throw error;
    return <>{fallback}</>;
  }
  if (me && me.organizations.length === 0) return <>{noOrganization(me)}</>;
  if (!value) return <>{fallback}</>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** Org-scoped query key: always prefixed so switching orgs can purge them together. */
export function useOrgKey(...parts: unknown[]) {
  const { org } = useSession();
  return ['org', org.id, ...parts] as const;
}
