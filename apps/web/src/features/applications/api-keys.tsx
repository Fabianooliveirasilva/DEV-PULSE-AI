'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/page';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/primitives';
import { useOrgKey, useSession } from '@/features/session/session';
import { api } from '@/lib/api';
import type { ApiKey } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

export function ApiKeysPanel({ applicationId }: { applicationId: string }) {
  const { orgPath, can } = useSession();
  const queryClient = useQueryClient();
  const key = useOrgKey('application', applicationId, 'api-keys');
  const [name, setName] = React.useState('');
  const [created, setCreated] = React.useState<ApiKey | null>(null);
  const keys = useQuery({
    queryKey: key,
    queryFn: () => api.get<ApiKey[]>(`${orgPath}/applications/${applicationId}/api-keys`),
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<ApiKey>(`${orgPath}/applications/${applicationId}/api-keys`, {
        name: name || 'default',
      }),
    onSuccess: (k) => {
      setCreated(k);
      setName('');
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api.delete(`${orgPath}/applications/${applicationId}/api-keys/${id}`),
    onSuccess: () => {
      toast.success('Key revoked');
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const canManage = can('apikeys:manage');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <div className="space-y-4">
      {created?.key && (
        <Card className="border-warning/40">
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">
              Copy this key now. You will not be able to see it again.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={created.key}
                className="font-mono text-xs"
                data-testid="new-api-key"
                aria-label="New API key"
              />
              <Button
                variant="secondary"
                onClick={() =>
                  navigator.clipboard.writeText(created.key!).then(() => toast.success('Copied'))
                }
                aria-label="Copy key"
              >
                <Copy />
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {`curl -X POST ${origin}/api/v1/ingest/logs \\
  -H "X-DevPulse-Key: ${created.key}" \\
  -H "content-type: application/json" \\
  -d '{"logs":[{"severity":"ERROR","message":"Payment provider timeout","environment":"production"}]}'`}
            </pre>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Log ingestion keys</CardTitle>
            <CardDescription>
              Keys authenticate log ingestion for this application only. Only a hash is stored.
            </CardDescription>
          </div>
          {canManage && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Key name"
                className="w-40"
                aria-label="Key name"
                maxLength={100}
              />
              <Button type="submit" loading={create.isPending}>
                <Plus /> Create key
              </Button>
            </form>
          )}
        </CardHeader>
        <CardContent>
          {keys.data && keys.data.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title="No keys"
              description="Create a key to send logs from this application."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Key</TH>
                  <TH>Created</TH>
                  <TH>Last used</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {keys.data?.map((k) => (
                  <TR key={k.id}>
                    <TD className="font-medium">{k.name}</TD>
                    <TD className="font-mono text-xs text-muted-foreground">dp_{k.prefix}_••••</TD>
                    <TD className="text-muted-foreground">{timeAgo(k.createdAt)}</TD>
                    <TD className="text-muted-foreground">
                      {k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'never'}
                    </TD>
                    <TD className="text-right">
                      {k.revokedAt ? (
                        <Badge>revoked</Badge>
                      ) : canManage ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-critical-text"
                          onClick={() =>
                            window.confirm(
                              `Revoke key “${k.name}”? Clients using it will be rejected.`,
                            ) && revoke.mutate(k.id)
                          }
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
