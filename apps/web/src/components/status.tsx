import type { IncidentStatus, Severity } from '@devpulse/shared';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownCircle,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Eye,
  PauseCircle,
  Search,
  ShieldAlert,
  Target,
} from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'info';

const MONITOR: Record<string, { tone: Tone; label: string; icon: typeof CheckCircle2 }> = {
  UP: { tone: 'good', label: 'Operational', icon: CheckCircle2 },
  DEGRADED: { tone: 'warning', label: 'Degraded', icon: AlertTriangle },
  DOWN: { tone: 'critical', label: 'Down', icon: ArrowDownCircle },
  PENDING: { tone: 'neutral', label: 'Pending', icon: CircleDashed },
  PAUSED: { tone: 'neutral', label: 'Paused', icon: PauseCircle },
  NO_MONITORS: { tone: 'neutral', label: 'No monitors', icon: CircleDashed },
};

/** Monitor / application status. Always icon + label: colour never carries meaning alone. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = MONITOR[status] ?? MONITOR.PENDING!;
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} className={className}>
      <Icon aria-hidden />
      {s.label}
    </Badge>
  );
}

const DOT: Record<string, string> = {
  UP: 'bg-good',
  DEGRADED: 'bg-warning',
  DOWN: 'bg-critical',
  PENDING: 'bg-subtle-foreground',
  PAUSED: 'bg-subtle-foreground',
};

export function StatusDot({ status, pulse }: { status: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2.5" aria-hidden>
      {pulse && status === 'DOWN' && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-critical opacity-60" />
      )}
      <span
        className={cn(
          'relative inline-flex size-2.5 rounded-full',
          DOT[status] ?? 'bg-subtle-foreground',
        )}
      />
    </span>
  );
}

const SEVERITY: Record<Severity, { tone: Tone; icon: typeof AlertOctagon }> = {
  CRITICAL: { tone: 'critical', icon: AlertOctagon },
  HIGH: { tone: 'serious', icon: ShieldAlert },
  MEDIUM: { tone: 'warning', icon: AlertTriangle },
  LOW: { tone: 'neutral', icon: CircleDot },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone}>
      <Icon aria-hidden />
      {severity.charAt(0) + severity.slice(1).toLowerCase()}
    </Badge>
  );
}

const INCIDENT: Record<IncidentStatus, { tone: Tone; icon: typeof Search; label: string }> = {
  OPEN: { tone: 'critical', icon: CircleDot, label: 'Open' },
  INVESTIGATING: { tone: 'serious', icon: Search, label: 'Investigating' },
  IDENTIFIED: { tone: 'warning', icon: Target, label: 'Identified' },
  MONITORING: { tone: 'info', icon: Eye, label: 'Monitoring' },
  RESOLVED: { tone: 'good', icon: CheckCircle2, label: 'Resolved' },
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const s = INCIDENT[status];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone}>
      <Icon aria-hidden />
      {s.label}
    </Badge>
  );
}

export const incidentStatusLabel = (s: IncidentStatus) => INCIDENT[s].label;

const LOG_TONE: Record<string, Tone> = {
  DEBUG: 'neutral',
  INFO: 'info',
  WARN: 'warning',
  ERROR: 'critical',
  FATAL: 'critical',
};
export function LogSeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge tone={LOG_TONE[severity] ?? 'neutral'} className="font-mono text-[11px]">
      {severity}
    </Badge>
  );
}
