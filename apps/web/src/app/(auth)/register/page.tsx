import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthHeading, RegisterForm } from '@/features/auth/forms';

export const metadata: Metadata = { title: 'Create account' };

export default function RegisterPage() {
  return (
    <>
      <AuthHeading
        title="Create your account"
        subtitle={
          <>
            Already have one?{' '}
            <Link href="/login" className="text-accent-text hover:underline">
              Log in
            </Link>
          </>
        }
      />
      <RegisterForm />
      <p className="mt-6 text-xs text-subtle-foreground">
        You will be the owner of the organization you create. You can invite teammates afterwards.
      </p>
    </>
  );
}
