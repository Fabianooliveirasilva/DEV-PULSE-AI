'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createOrganizationSchema } from '@devpulse/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import { FieldError, Input, Label } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { Organization } from '@/lib/types';

type Values = z.input<typeof createOrganizationSchema>;

export function CreateOrganizationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (org: Organization) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: '' },
  });
  const create = useMutation({
    mutationFn: (values: Values) => api.post<Organization>('/orgs', values),
    onSuccess: async (org) => {
      try {
        localStorage.setItem('devpulse.org', org.id);
      } catch {
        /* ignore */
      }
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.success(`Organization “${org.name}” created`);
      form.reset();
      onOpenChange(false);
      onCreated?.(org);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Create organization"
        description="Organizations isolate applications, data and members. You will be its owner."
      >
        <form
          onSubmit={form.handleSubmit((v) => create.mutate(v))}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              autoFocus
              placeholder="Acme Inc."
              aria-invalid={!!form.formState.errors.name}
              {...form.register('name')}
            />
            <FieldError message={form.formState.errors.name?.message} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create organization
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
