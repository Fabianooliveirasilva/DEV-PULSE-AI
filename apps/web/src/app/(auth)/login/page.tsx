import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthHeading, LoginForm } from '@/features/auth/forms';

export const metadata: Metadata = { title: 'Log in' };

export default function LoginPage() {
  return (
    <>
      <AuthHeading
        title="Welcome back"
        subtitle={
          <>
            New to DevPulse AI?{' '}
            <Link href="/register" className="text-accent-text hover:underline">
              Create an account
            </Link>
          </>
        }
      />
      <Suspense>
        <LoginForm />
      </Suspense>
    </>
  );
}
