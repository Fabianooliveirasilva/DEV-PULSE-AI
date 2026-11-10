'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { HTTP_METHODS, monitorUrlSchema } from '@devpulse/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/primitives';
import { useSession } from '@/features/session/session';
import { api } from '@/lib/api';
import type { Monitor } from '@/lib/types';

// Form-level schema: text inputs are coerced; the API re-validates with the shared schema.
const formSchema = z
  .object({
    name: z.string().trim().min(1, 'Required').max(100),
    url: monitorUrlSchema,
    method: z.enum(HTTP_METHODS),
    expectedStatusCodes: z
      .string()
      .trim()
      .refine(
        (v) => v === '' || v.split(',').every((c) => /^\s*[1-5]\d\d\s*$/.test(c)),
        'Comma-separated HTTP codes, e.g. 200,204',
      ),
    intervalSeconds: z.coerce.number<string>().int().min(30, 'Minimum 30 seconds').max(86_400),
    timeoutMs: z.coerce
      .number<string>()
      .int()
      .min(1000, 'Minimum 1000 ms')
      .max(30_000, 'Maximum 30000 ms'),
    failureThreshold: z.coerce.number<string>().int().min(1).max(10),
    latencyThresholdMs: z
      .string()
      .trim()
      .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 50), 'Empty or ≥ 50 ms'),
  })
  .refine((v) => v.timeoutMs < v.intervalSeconds * 1000, {
    message: 'Timeout must be shorter than the interval',
    path: ['timeoutMs'],
  });

type FormInput = z.input<typeof formSchema>;

function toPayload(v: z.output<typeof formSchema>) {
  return {
    name: v.name,
    url: v.url,
    method: v.method,
    expectedStatusCodes: v.expectedStatusCodes
      ? v.expectedStatusCodes.split(',').map((c) => Number(c.trim()))
      : [],
    intervalSeconds: v.intervalSeconds,
    timeoutMs: v.timeoutMs,
    failureThreshold: v.failureThreshold,
    latencyThresholdMs: v.latencyThresholdMs ? Number(v.latencyThresholdMs) : null,
  };
}

export function MonitorDialog({
  open,
  onOpenChange,
  applicationId,
  monitor,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  applicationId: string;
  monitor?: Monitor;
}) {
  const { orgPath, org } = useSession();
  const queryClient = useQueryClient();
  const form = useForm<FormInput, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    values: {
      name: monitor?.name ?? '',
      url: monitor?.url ?? 'https://',
      method: monitor?.method ?? 'GET',
      expectedStatusCodes: monitor?.expectedStatusCodes.join(',') ?? '',
      intervalSeconds: String(monitor?.intervalSeconds ?? 60),
      timeoutMs: String(monitor?.timeoutMs ?? 10_000),
      failureThreshold: String(monitor?.failureThreshold ?? 3),
      latencyThresholdMs: monitor?.latencyThresholdMs ? String(monitor.latencyThresholdMs) : '',
    },
  });
  const save = useMutation({
    mutationFn: (values: z.output<typeof formSchema>) =>
      monitor
        ? api.patch<Monitor>(`${orgPath}/monitors/${monitor.id}`, toPayload(values))
        : api.post<Monitor>(`${orgPath}/monitors`, { ...toPayload(values), applicationId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['org', org.id] });
      toast.success(monitor ? 'Monitor updated' : 'Monitor created — first check is queued');
      onOpenChange(false);
    },
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={monitor ? 'Edit monitor' : 'New monitor'}
        description="The worker requests this URL on every interval. Private and internal addresses are blocked."
        className="max-w-xl"
      >
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <div className="space-y-1.5">
              <Label htmlFor="m-name">Name</Label>
              <Input
                id="m-name"
                placeholder="Health endpoint"
                aria-invalid={!!e.name}
                {...form.register('name')}
              />
              <FieldError message={e.name?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-method">Method</Label>
              <NativeSelect id="m-method" {...form.register('method')}>
                {HTTP_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-url">URL</Label>
            <Input
              id="m-url"
              placeholder="https://api.example.com/health"
              aria-invalid={!!e.url}
              className="font-mono text-xs"
              {...form.register('url')}
            />
            <FieldError message={e.url?.message} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-interval">Interval (s)</Label>
              <Input
                id="m-interval"
                inputMode="numeric"
                aria-invalid={!!e.intervalSeconds}
                {...form.register('intervalSeconds')}
              />
              <FieldError message={e.intervalSeconds?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-timeout">Timeout (ms)</Label>
              <Input
                id="m-timeout"
                inputMode="numeric"
                aria-invalid={!!e.timeoutMs}
                {...form.register('timeoutMs')}
              />
              <FieldError message={e.timeoutMs?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-threshold">Failures to alert</Label>
              <Input
                id="m-threshold"
                inputMode="numeric"
                aria-invalid={!!e.failureThreshold}
                {...form.register('failureThreshold')}
              />
              <FieldError message={e.failureThreshold?.message} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-codes">Expected status codes</Label>
              <Input
                id="m-codes"
                placeholder="Any 2xx"
                aria-invalid={!!e.expectedStatusCodes}
                {...form.register('expectedStatusCodes')}
              />
              <FieldError message={e.expectedStatusCodes?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-latency">Latency threshold (ms)</Label>
              <Input
                id="m-latency"
                placeholder="Optional"
                inputMode="numeric"
                aria-invalid={!!e.latencyThresholdMs}
                {...form.register('latencyThresholdMs')}
              />
              <FieldError message={e.latencyThresholdMs?.message} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {monitor ? 'Save changes' : 'Create monitor'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
