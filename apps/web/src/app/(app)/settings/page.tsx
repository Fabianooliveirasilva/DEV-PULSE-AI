'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { PageHeader } from '@/components/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { useSession } from '@/features/session/session';
import {
  AuditPanel,
  ChannelsPanel,
  GeneralPanel,
  MembersPanel,
  ProjectsPanel,
} from '@/features/settings/panels';

function SettingsInner() {
  const { org, can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const tabs = [
    { id: 'general', label: 'General', show: true },
    { id: 'members', label: 'Members', show: true },
    { id: 'projects', label: 'Projects', show: true },
    { id: 'channels', label: 'Channels', show: true },
    { id: 'audit', label: 'Audit log', show: can('audit:read') },
  ].filter((t) => t.show);
  const current = tabs.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'general';
  return (
    <>
      <PageHeader
        title="Settings"
        description={`Configuration for ${org.name}. Your role: ${org.role.toLowerCase()}.`}
      />
      <Tabs value={current} onValueChange={(v) => router.replace(`/settings?tab=${v}`)}>
        <TabsList className="max-w-full overflow-x-auto">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          <GeneralPanel />
        </TabsContent>
        <TabsContent value="members">
          <MembersPanel />
        </TabsContent>
        <TabsContent value="projects">
          <ProjectsPanel />
        </TabsContent>
        <TabsContent value="channels">
          <ChannelsPanel />
        </TabsContent>
        {can('audit:read') && (
          <TabsContent value="audit">
            <AuditPanel />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}

export default function SettingsPage() {
  return (
    <React.Suspense>
      <SettingsInner />
    </React.Suspense>
  );
}
