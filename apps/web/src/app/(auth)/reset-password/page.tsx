import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthHeading, ResetPasswordForm } from '@/features/auth/forms';

export const metadata: Metadata = { title: 'Choose a new password' };

export default function ResetPasswordPage() {
  return (
    <>
      <AuthHeading
        title="Choose a new password"
        subtitle="The link in your e-mail can be used once and expires after 30 minutes."
      />
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </>
  );
}
