import type { IncidentStatus } from './enums.js';

/**
 * Allowed transitions. Incidents move forward through the investigation, may step back
 * (e.g. MONITORING → INVESTIGATING when a fix did not hold) and can be reopened.
 */
const TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  OPEN: ['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'],
  INVESTIGATING: ['IDENTIFIED', 'MONITORING', 'RESOLVED'],
  IDENTIFIED: ['INVESTIGATING', 'MONITORING', 'RESOLVED'],
  MONITORING: ['INVESTIGATING', 'IDENTIFIED', 'RESOLVED'],
  RESOLVED: ['OPEN'],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: IncidentStatus): readonly IncidentStatus[] {
  return TRANSITIONS[from];
}

/** Duration in ms between opening and resolution (or now, while unresolved). */
export function incidentDurationMs(
  openedAt: Date,
  resolvedAt: Date | null,
  now = new Date(),
): number {
  return Math.max(0, (resolvedAt ?? now).getTime() - openedAt.getTime());
}

/** Mean time to resolve over resolved incidents; null when none are resolved. */
export function mttrMs(
  incidents: readonly { openedAt: Date; resolvedAt: Date | null }[],
): number | null {
  const resolved = incidents.filter((i) => i.resolvedAt !== null);
  if (resolved.length === 0) return null;
  const total = resolved.reduce((acc, i) => acc + incidentDurationMs(i.openedAt, i.resolvedAt), 0);
  return Math.round(total / resolved.length);
}
