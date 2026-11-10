'use client';

import { format } from 'date-fns';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMs } from '@/lib/utils';

// Chart conventions (see docs/DECISIONS.md, dataviz method):
// thin 2px lines, recessive grid, one y-axis per chart, hover crosshair + tooltip,
// series colours from validated tokens, text in ink tokens (never series colours).

const axis = {
  stroke: 'var(--chart-axis)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function tickFormatter(range: string) {
  return (v: string) => format(new Date(v), range === '24h' ? 'HH:mm' : 'MMM d');
}

interface TooltipRow {
  label: string;
  value: string;
  color: string;
}

function ChartTooltip({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="rounded-md border border-border-strong bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-foreground">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-muted-foreground">
          <span
            className="inline-block h-0.5 w-3 rounded"
            style={{ background: r.color }}
            aria-hidden
          />
          <span>{r.label}</span>
          <span className="ml-auto pl-4 font-medium text-foreground tabular">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export interface SeriesPoint {
  bucket: string;
  uptime: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  checks: number;
  failures: number;
}

/** Availability over time: one series, so no legend — the card title names it. */
export function UptimeChart({ data, range }: { data: SeriesPoint[]; range: string }) {
  const min = Math.min(99, ...data.map((d) => d.uptime ?? 100));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="uptimeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="bucket" tickFormatter={tickFormatter(range)} {...axis} minTickGap={32} />
        <YAxis
          domain={[Math.floor(min), 100]}
          tickFormatter={(v: number) => `${v}%`}
          {...axis}
          width={48}
        />
        <ReferenceLine y={99} stroke="var(--chart-axis)" strokeDasharray="3 3" />
        <Tooltip
          cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            const p = payload?.[0]?.payload as SeriesPoint | undefined;
            if (!active || !p) return null;
            return (
              <ChartTooltip
                title={format(new Date(p.bucket), 'MMM d, HH:mm')}
                rows={[
                  {
                    label: 'Uptime',
                    value: p.uptime === null ? '—' : `${p.uptime}%`,
                    color: 'var(--series-1)',
                  },
                  {
                    label: 'Failed checks',
                    value: `${p.failures} / ${p.checks}`,
                    color: 'transparent',
                  },
                ]}
              />
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="uptime"
          stroke="var(--series-1)"
          strokeWidth={2}
          fill="url(#uptimeFill)"
          connectNulls
          isAnimationActive={false}
          dot={data.length <= 2 ? { r: 4, fill: 'var(--series-1)' } : false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Average and p95 latency share one unit (ms) and therefore one axis. Legend + direct labels. */
export function LatencyChart({ data, range }: { data: SeriesPoint[]; range: string }) {
  const last = [...data].reverse().find((d) => d.avgLatencyMs !== null);
  // With one or two buckets a line has nothing to connect: draw markers (≥8px) instead.
  const sparse = data.length <= 2;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legend">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-[var(--series-1)]" aria-hidden />{' '}
          Average{' '}
          {last ? (
            <b className="font-medium text-foreground">{formatMs(last.avgLatencyMs)}</b>
          ) : null}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-[var(--series-2)]" aria-hidden /> p95{' '}
          {last ? (
            <b className="font-medium text-foreground">{formatMs(last.p95LatencyMs)}</b>
          ) : null}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={tickFormatter(range)} {...axis} minTickGap={32} />
          <YAxis tickFormatter={(v: number) => `${v} ms`} {...axis} width={60} />
          <Tooltip
            cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as SeriesPoint | undefined;
              if (!active || !p) return null;
              return (
                <ChartTooltip
                  title={format(new Date(p.bucket), 'MMM d, HH:mm')}
                  rows={[
                    { label: 'Average', value: formatMs(p.avgLatencyMs), color: 'var(--series-1)' },
                    { label: 'p95', value: formatMs(p.p95LatencyMs), color: 'var(--series-2)' },
                  ]}
                />
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="avgLatencyMs"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={sparse ? { r: 4, fill: 'var(--series-1)' } : false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="p95LatencyMs"
            stroke="var(--series-2)"
            strokeWidth={2}
            dot={sparse ? { r: 4, fill: 'var(--series-2)' } : false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Check-by-check strip (newest right). Each cell is a check; colour + tooltip text. */
export function CheckStrip({
  checks,
}: {
  checks: {
    id: string;
    result: string;
    checkedAt: string;
    latencyMs: number | null;
    statusCode: number | null;
  }[];
}) {
  const ordered = [...checks].reverse();
  const color = (r: string) =>
    r === 'DOWN' ? 'bg-critical' : r === 'DEGRADED' ? 'bg-warning' : 'bg-good';
  return (
    <div
      className="flex h-8 items-stretch justify-end gap-[2px]"
      role="img"
      aria-label={`Last ${checks.length} checks: ${checks.filter((c) => c.result === 'DOWN').length} failed`}
    >
      {ordered.map((c) => (
        <span
          key={c.id}
          title={`${format(new Date(c.checkedAt), 'MMM d HH:mm:ss')} · ${c.result} · ${c.statusCode ?? 'no response'} · ${formatMs(c.latencyMs)}`}
          className={`max-w-[12px] min-w-[3px] flex-1 rounded-[2px] ${color(c.result)} opacity-90 hover:opacity-100`}
        />
      ))}
    </div>
  );
}
