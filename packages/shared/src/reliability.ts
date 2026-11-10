import type { CheckResult } from './enums.js';

export interface CheckSample {
  result: CheckResult;
  latencyMs: number | null;
}

/**
 * Uptime counts DEGRADED as available: the endpoint answered with an accepted status,
 * it was only slower than the configured latency threshold.
 * Returns null when there is no data — "no data" must never be reported as 100 %.
 */
export function uptimePercent(samples: readonly Pick<CheckSample, 'result'>[]): number | null {
  if (samples.length === 0) return null;
  const available = samples.filter((s) => s.result !== 'DOWN').length;
  return round((available / samples.length) * 100, 3);
}

/** Uptime from pre-aggregated counters (used with SQL GROUP BY results). */
export function uptimeFromCounts(total: number, down: number): number | null {
  if (total <= 0) return null;
  return round(((total - down) / total) * 100, 3);
}

/** Nearest-rank percentile on a copy of the input. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  if (p < 0 || p > 100) throw new RangeError('percentile must be within [0, 100]');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((acc, v) => acc + v, 0) / values.length, 1);
}

export interface LatencyStats {
  avg: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export function latencyStats(samples: readonly CheckSample[]): LatencyStats {
  const latencies = samples
    .filter((s) => s.result !== 'DOWN' && s.latencyMs !== null)
    .map((s) => s.latencyMs as number);
  return {
    avg: mean(latencies),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
  };
}

/**
 * Flapping score: share of consecutive check pairs whose availability flipped.
 * 0 = perfectly stable, 1 = alternating every check. Samples must be chronological.
 */
export function flapRate(samples: readonly Pick<CheckSample, 'result'>[]): number {
  if (samples.length < 2) return 0;
  let flips = 0;
  for (let i = 1; i < samples.length; i++) {
    const prevUp = samples[i - 1]!.result !== 'DOWN';
    const currUp = samples[i]!.result !== 'DOWN';
    if (prevUp !== currUp) flips++;
  }
  return round(flips / (samples.length - 1), 3);
}

export interface StabilityInput {
  uptime: number | null;
  flapRate: number;
  p95LatencyMs: number | null;
  latencyThresholdMs: number | null;
}

/** An endpoint is unstable when it is flapping, below 99 % uptime, or p95 breaches its threshold. */
export function isUnstable({
  uptime,
  flapRate: flap,
  p95LatencyMs,
  latencyThresholdMs,
}: StabilityInput) {
  const reasons: string[] = [];
  if (uptime !== null && uptime < 99) reasons.push(`uptime ${uptime}% is below 99%`);
  if (flap >= 0.1) reasons.push(`availability flipped on ${Math.round(flap * 100)}% of checks`);
  if (latencyThresholdMs !== null && p95LatencyMs !== null && p95LatencyMs > latencyThresholdMs) {
    reasons.push(`p95 latency ${p95LatencyMs}ms exceeds threshold ${latencyThresholdMs}ms`);
  }
  return { unstable: reasons.length > 0, reasons };
}

function round(value: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
