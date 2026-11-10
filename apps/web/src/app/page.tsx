import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  FileSearch,
  Gauge,
  KeyRound,
  Lock,
  ScrollText,
  ShieldCheck,
  Siren,
} from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';

const MODULES = [
  {
    icon: Activity,
    title: 'Application monitoring',
    text: 'HTTP checks on your schedule with status-code rules, latency thresholds and timeouts. Failure streaks, not single blips, change status.',
  },
  {
    icon: Siren,
    title: 'Incident management',
    text: 'Incidents open from failing checks and close on recovery. Track status, owners, comments and a full timeline up to the post-incident report.',
  },
  {
    icon: ScrollText,
    title: 'Logs & error groups',
    text: 'Ship logs with an API key. Secrets are redacted on arrival and similar errors are grouped by fingerprint, with spike detection.',
  },
  {
    icon: Gauge,
    title: 'Reliability & QA',
    text: 'Uptime, success rate, p50/p95/p99 latency, flapping endpoints and regressions against the previous period.',
  },
];

const STEPS = [
  { n: '01', title: 'Add an application', text: 'Group services by project and environment.' },
  {
    n: '02',
    title: 'Point monitors at it',
    text: 'Pick the URL, interval, expected codes and failure threshold.',
  },
  {
    n: '03',
    title: 'Investigate with context',
    text: 'Open the incident: checks, logs and the AI analysis are already there.',
  },
];

function ProductPreview() {
  const bars = [
    100, 100, 100, 99.2, 100, 100, 97.1, 100, 100, 100, 100, 100, 98.4, 100, 100, 100, 100, 100,
    100, 100, 99.7, 100, 100, 100,
  ];
  return (
    <figure
      className="relative mx-auto mt-16 max-w-5xl"
      aria-label="Illustrative preview of the DevPulse AI dashboard with sample data"
    >
      <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl shadow-black/40">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-surface-3" />
          <span className="size-2.5 rounded-full bg-surface-3" />
          <span className="size-2.5 rounded-full bg-surface-3" />
          <span className="ml-3 text-xs text-subtle-foreground">Sample data</span>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Uptime · 24h', '99.87%'],
                ['Avg response', '182 ms'],
                ['Open incidents', '1'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md border border-border bg-surface-2 p-3">
                  <div className="text-[11px] text-muted-foreground">{k}</div>
                  <div className="mt-1 text-lg font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <div className="mb-3 text-[11px] text-muted-foreground">Availability per hour</div>
              <div className="flex h-16 items-end gap-[3px]">
                {bars.map((b, i) => (
                  <span
                    key={i}
                    className={
                      b < 99
                        ? 'flex-1 rounded-t-[3px] bg-critical'
                        : 'flex-1 rounded-t-[3px] bg-[var(--series-1)]'
                    }
                    style={{ height: `${Math.max(20, (b - 95) * 20)}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-md border border-border bg-surface-2 p-3 text-xs">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <BrainCircuit className="size-3.5 text-accent-text" aria-hidden /> AI analysis ·
              checkout-api
            </div>
            <p className="leading-relaxed text-foreground">
              All 3 failing checks report ECONNREFUSED on port 443 while DNS resolves normally.
            </p>
            <div className="mt-3 space-y-2">
              <div className="rounded border border-good/30 bg-good/10 p-2">
                <div className="font-medium text-good-text">Supported by evidence</div>
                <div className="text-muted-foreground">
                  Service not accepting connections · check:1–3
                </div>
              </div>
              <div className="rounded border border-border-strong p-2">
                <div className="font-medium text-muted-foreground">Hypothesis</div>
                <div className="text-muted-foreground">
                  Recent deploy failed health checks · needs deploy logs
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Logo />
          <nav className="flex items-center gap-2" aria-label="Site">
            <a
              href="#features"
              className="hidden px-3 text-sm text-muted-foreground hover:text-foreground sm:inline"
            >
              Features
            </a>
            <a
              href="#security"
              className="hidden px-3 text-sm text-muted-foreground hover:text-foreground sm:inline"
            >
              Security
            </a>
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/register">Start monitoring</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-6 pt-20 pb-24">
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_65%)]" />
          <div className="relative mx-auto max-w-3xl text-center">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface px-3 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-good" aria-hidden /> Monitoring · Incidents
              · Logs · AI
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Find out what broke, <span className="text-accent-text">and why</span>, before your
              users do.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
              DevPulse AI checks your web apps and APIs, opens incidents when they fail, groups your
              errors, and uses AI to explain them, separating what the evidence shows from what is
              only a guess.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/register">
                  Create free account <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/login">Log in</Link>
              </Button>
            </div>
          </div>
          <ProductPreview />
        </section>

        <section id="features" className="border-t border-border px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-2xl font-semibold tracking-tight">Four modules, one timeline</h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Checks, incidents, logs and analyses share the same data model, so every page links to
              the evidence behind it.
            </p>
            <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
              {MODULES.map(({ icon: Icon, title, text }) => (
                <div key={title} className="bg-surface p-7">
                  <Icon className="size-5 text-accent-text" aria-hidden />
                  <h3 className="mt-4 font-medium">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border px-6 py-24">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                AI error intelligence you can audit
              </h2>
              <p className="mt-3 text-muted-foreground">
                The model receives a bounded, redacted summary of checks, events and logs. It cannot
                query your database or touch your systems, and every analysis records its prompt
                version, model and cost.
              </p>
              <ul className="mt-8 space-y-4 text-sm">
                {[
                  'Each hypothesis cites the checks and log lines behind it. Unsupported claims are downgraded automatically.',
                  'Log content is treated as untrusted data, which protects the analysis against prompt injection hidden in your logs.',
                  'Monthly budgets per organization, with per-call usage tracking.',
                  'No API key configured? You see that clearly. Nothing is ever simulated.',
                ].map((t) => (
                  <li key={t} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good-text" aria-hidden />
                    <span className="text-muted-foreground">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <ol className="space-y-3 self-center">
              {STEPS.map((s) => (
                <li key={s.n} className="flex gap-5 rounded-lg border border-border bg-surface p-5">
                  <span className="font-mono text-sm text-accent-text">{s.n}</span>
                  <span>
                    <span className="block font-medium">{s.title}</span>
                    <span className="block text-sm text-muted-foreground">{s.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="security" className="border-t border-border px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-2xl font-semibold tracking-tight">
              Built with security in mind from day one
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: ShieldCheck,
                  title: 'SSRF-hardened checks',
                  text: 'Private, loopback and metadata ranges are blocked, including after DNS resolution and redirects.',
                },
                {
                  icon: Lock,
                  title: 'Tenant isolation',
                  text: 'Every query is scoped by organization, with role-based permissions on every action.',
                },
                {
                  icon: KeyRound,
                  title: 'Secrets stay secret',
                  text: 'Argon2id passwords, hashed session and API tokens, redaction of logged credentials.',
                },
                {
                  icon: FileSearch,
                  title: 'Audit trail',
                  text: 'Logins, membership changes and key management are recorded.',
                },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title}>
                  <Icon className="size-5 text-accent-text" aria-hidden />
                  <h3 className="mt-3 text-sm font-medium">{title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border px-6 py-20">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 rounded-xl border border-border-strong bg-surface p-10 md:flex-row md:items-center">
            <div>
              <h2 className="text-xl font-semibold">Start with one endpoint. It takes a minute.</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create an account, add a monitor and watch the first check land.
              </p>
            </div>
            <Button asChild size="lg">
              <Link href="/register">Get started</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-3 text-xs text-subtle-foreground sm:flex-row">
          <Logo className="text-sm text-muted-foreground" />
          <p>© {new Date().getFullYear()} DevPulse AI. Open-source portfolio project.</p>
        </div>
      </footer>
    </div>
  );
}
