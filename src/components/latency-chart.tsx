"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import { formatClock, formatMs } from "@/lib/format";
import type { CheckResult } from "@/lib/types";

/**
 * Response time over the retained window. One series on one axis — latency is
 * the only measure here, so there is no legend: the heading names it.
 */

const SIGNAL = "#22d3ee";

interface Point {
  t: number;
  ms: number;
  status: CheckResult["s"];
  code?: number;
  error?: string;
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as Point;

  return (
    <div className="glass rounded-lg border border-edge-bright px-3 py-2 text-xs shadow-2xl">
      <div className="font-mono text-ink">{formatClock(point.t)}</div>
      <div className="mt-1 flex items-baseline gap-2">
        {/* The colored mark carries identity; the text stays in ink tokens. */}
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: SIGNAL }}
        />
        <span className="font-mono text-sm text-ink">{formatMs(point.ms)}</span>
      </div>
      <div className="mt-1 text-ink-dim">
        {point.status === "down"
          ? (point.error ?? "Failed")
          : `${point.status}${point.code ? ` · HTTP ${point.code}` : ""}`}
      </div>
    </div>
  );
}

export function LatencyChart({
  checks,
  height = 260,
}: {
  checks: CheckResult[];
  height?: number;
}) {
  const data: Point[] = checks.map((c) => ({
    t: c.t,
    ms: c.ms,
    status: c.s,
    code: c.c,
    error: c.e,
  }));

  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-sm text-ink-faint"
        style={{ height }}
      >
        Not enough samples yet — the chart appears after the second check.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SIGNAL} stopOpacity={0.3} />
            <stop offset="100%" stopColor={SIGNAL} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Hairline, solid, one shade off the surface — recessive by design. */}
        <CartesianGrid stroke="#1a2234" strokeWidth={1} vertical={false} />

        <XAxis
          dataKey="t"
          tickFormatter={(t: number) => formatClock(t)}
          stroke="#1a2234"
          tick={{ fill: "#56637d", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={48}
        />
        <YAxis
          tickFormatter={(ms: number) => `${Math.round(ms)}`}
          stroke="#1a2234"
          tick={{ fill: "#56637d", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
        />

        <Tooltip
          content={<ChartTooltip />}
          cursor={{ stroke: "#2a3550", strokeWidth: 1 }}
        />

        <Area
          type="monotone"
          dataKey="ms"
          stroke={SIGNAL}
          strokeWidth={2}
          fill="url(#latencyFill)"
          // Points only appear on hover, at a comfortable hit size.
          dot={false}
          activeDot={{ r: 4, fill: SIGNAL, stroke: "#0c111d", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Shared legend for the status colors, so state is never encoded by hue alone. */
export function StatusLegend() {
  const items = [
    { label: "Operational", color: "#34d399" },
    { label: "Degraded", color: "#fbbf24" },
    { label: "Outage", color: "#fb7185" },
    { label: "No data", color: "#1a2234" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-dim">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
