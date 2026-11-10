import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthHeading, ForgotPasswordForm } from '@/features/auth/forms';

export const metadata: Metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading
        title="Reset your password"
        subtitle={
          <>
            Remembered it?{' '}
            <Link href="/login" className="text-accent-text hover:underline">
              Back to log in
            </Link>
          </>
        }
      />
      <ForgotPasswordForm />
    </>
  );
}
