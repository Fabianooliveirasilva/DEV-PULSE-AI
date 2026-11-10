'use client';

import { useQuery } from '@tanstack/react-query';
import { TIME_RANGES, type TimeRange } from '@devpulse/shared';
import { Select } from '@/components/ui/overlays';
import { useOrgKey, useSession } from '@/features/session/session';
import { api } from '@/lib/api';
import type { ApplicationSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

const LABEL: Record<TimeRange, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };

export function RangeToggle({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Time range"
      className="inline-flex h-9 items-center rounded-md border border-border bg-surface-2 p-1"
    >
      {TIME_RANGES.map((r) => (
        <button
          key={r}
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={cn(
            'h-7 rounded-sm px-3 text-xs font-medium transition-colors',
            value === r
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {LABEL[r]}
        </button>
      ))}
    </div>
  );
}

export function useApplications() {
  const { orgPath } = useSession();
  return useQuery({
    queryKey: useOrgKey('applications'),
    queryFn: () => api.get<ApplicationSummary[]>(`${orgPath}/applications`),
  });
}

export function ApplicationFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data } = useApplications();
  return (
    <Select
      aria-label="Filter by application"
      className="w-48"
      value={value}
      onValueChange={onChange}
      options={[
        { value: 'all', label: 'All applications' },
        ...(data ?? []).map((a) => ({ value: a.id, label: a.name })),
      ]}
    />
  );
}
