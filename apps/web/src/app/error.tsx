'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center"
      role="alert"
    >
      <AlertTriangle className="size-6 text-critical-text" aria-hidden />
      <div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          The page could not be displayed. The error was logged
          {error.digest ? ` (ref ${error.digest})` : ''}.
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
