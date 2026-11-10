import { cn } from '@/lib/utils';

/** DevPulse AI mark: a pulse line crossing a rounded square. */
export function Logo({
  className,
  withWordmark = true,
}: {
  className?: string;
  withWordmark?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 28 28" className="size-7" aria-hidden>
        <rect x="1" y="1" width="26" height="26" rx="7" className="fill-primary" />
        <path
          d="M5 15h4.2l2.3-6 3.6 11 2.4-7.2 1.5 2.2H23"
          fill="none"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {withWordmark && (
        <span>
          DevPulse <span className="text-accent-text">AI</span>
        </span>
      )}
    </span>
  );
}
