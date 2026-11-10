'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@devpulse/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { useForm, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { safeNext } from '@/lib/navigation';

function Field<T extends FieldValues>({
  form,
  name,
  label,
  type = 'text',
  autoComplete,
  hint,
}: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
}) {
  const error = form.formState.errors[name]?.message as string | undefined;
  const id = `field-${name}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={!!error}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...form.register(name)}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldError message={error} />
    </div>
  );
}

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical-text"
    >
      {errorMessage(error)}
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const login = useMutation({
    mutationFn: (v: z.input<typeof loginSchema>) => api.post('/auth/login', v),
    meta: { silent: true },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      router.replace(safeNext(params.get('next')));
    },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => login.mutate(v))} className="space-y-4" noValidate>
      <FormError error={login.error} />
      <Field form={form} name="email" label="Email" type="email" autoComplete="email" />
      <div className="space-y-1.5">
        <Field
          form={form}
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        <div className="text-right">
          <Link href="/forgot-password" className="text-xs text-accent-text hover:underline">
            Forgot password?
          </Link>
        </div>
      </div>
      <Button type="submit" className="w-full" loading={login.isPending}>
        Log in
      </Button>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', organizationName: '' },
  });
  const register = useMutation({
    mutationFn: (v: z.input<typeof registerSchema>) => api.post('/auth/register', v),
    meta: { silent: true },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      router.replace('/dashboard');
    },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => register.mutate(v))} className="space-y-4" noValidate>
      <FormError error={register.error} />
      <Field form={form} name="name" label="Full name" autoComplete="name" />
      <Field form={form} name="email" label="Work email" type="email" autoComplete="email" />
      <Field
        form={form}
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters. A passphrase works well."
      />
      <Field
        form={form}
        name="organizationName"
        label="Organization name"
        autoComplete="organization"
      />
      <Button type="submit" className="w-full" loading={register.isPending}>
        Create account
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const form = useForm<z.input<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const forgot = useMutation({
    mutationFn: (v: z.input<typeof forgotPasswordSchema>) => api.post('/auth/forgot-password', v),
    meta: { silent: true },
  });
  if (forgot.isSuccess) {
    return (
      <div
        className="space-y-3 rounded-lg border border-border bg-surface p-5 text-sm"
        role="status"
      >
        <MailCheck className="size-5 text-good-text" aria-hidden />
        <p className="font-medium">Check your inbox</p>
        <p className="text-muted-foreground">
          If an account exists for that address, we sent a link to reset the password. It expires in
          30 minutes.
        </p>
      </div>
    );
  }
  return (
    <form onSubmit={form.handleSubmit((v) => forgot.mutate(v))} className="space-y-4" noValidate>
      <FormError error={forgot.error} />
      <Field form={form} name="email" label="Email" type="email" autoComplete="email" />
      <Button type="submit" className="w-full" loading={forgot.isPending}>
        Send reset link
      </Button>
    </form>
  );
}

const resetFormSchema = resetPasswordSchema
  .extend({ confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const form = useForm<z.input<typeof resetFormSchema>>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { token, password: '', confirm: '' },
  });
  const reset = useMutation({
    mutationFn: (v: z.input<typeof resetFormSchema>) =>
      api.post('/auth/reset-password', { token: v.token, password: v.password }),
    meta: { silent: true },
  });
  if (!token) {
    return (
      <div
        role="alert"
        className="rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical-text"
      >
        This reset link is incomplete.{' '}
        <Link href="/forgot-password" className="underline">
          Request a new one
        </Link>
        .
      </div>
    );
  }
  if (reset.isSuccess) {
    return (
      <div
        className="space-y-3 rounded-lg border border-border bg-surface p-5 text-sm"
        role="status"
      >
        <CheckCircle2 className="size-5 text-good-text" aria-hidden />
        <p className="font-medium">Password updated</p>
        <p className="text-muted-foreground">
          All existing sessions were signed out. Log in with your new password.
        </p>
        <Button asChild className="w-full">
          <Link href="/login">Go to log in</Link>
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={form.handleSubmit((v) => reset.mutate(v))} className="space-y-4" noValidate>
      <FormError error={reset.error} />
      <input type="hidden" {...form.register('token')} />
      <Field
        form={form}
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
      />
      <Field
        form={form}
        name="confirm"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
      />
      <Button type="submit" className="w-full" loading={reset.isPending}>
        Set new password
      </Button>
    </form>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
