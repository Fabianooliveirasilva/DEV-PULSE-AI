import { Activity, BrainCircuit, Siren } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/logo';

const POINTS = [
  {
    icon: Activity,
    title: 'Real HTTP checks',
    text: 'Status codes, latency and timeouts from an SSRF-hardened worker.',
  },
  {
    icon: Siren,
    title: 'Incidents that open themselves',
    text: 'Consecutive failures open an incident; recovery resolves it.',
  },
  {
    icon: BrainCircuit,
    title: 'AI that shows its evidence',
    text: 'Hypotheses are labelled as hypotheses and cite the checks and logs behind them.',
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_480px] xl:grid-cols-[1fr_560px]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-surface p-10 lg:flex">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]" />
        <Link href="/" className="relative">
          <Logo />
        </Link>
        <div className="relative max-w-md space-y-7">
          <h2 className="text-2xl font-semibold tracking-tight">
            Know when production breaks, and why.
          </h2>
          <ul className="space-y-5">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2">
                  <Icon className="size-4 text-accent-text" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block text-sm text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-subtle-foreground">
          © {new Date().getFullYear()} DevPulse AI
        </p>
      </section>
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <Link href="/" className="mb-10 lg:hidden">
          <Logo />
        </Link>
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
