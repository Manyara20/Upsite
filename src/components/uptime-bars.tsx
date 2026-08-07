"use client";

import { cn } from "@/lib/format";
import type { DayBucket } from "@/lib/types";

/**
 * The daily uptime strip — one bar per calendar day, newest on the right.
 * Days with no data render as inert slots so the timeline keeps its true
 * width instead of silently compressing gaps.
 */

function barColor(bucket: DayBucket | null): string {
  if (!bucket || bucket.n === 0) return "bg-edge";

  const uptime = (bucket.n - bucket.down) / bucket.n;
  if (uptime < 0.95) return "bg-down";
  if (uptime < 0.999 || bucket.deg / bucket.n > 0.1) return "bg-degraded";
  return "bg-up";
}

function tooltip(day: string, bucket: DayBucket | null): string {
  if (!bucket || bucket.n === 0) return `${day} · no data`;
  const uptime = ((bucket.n - bucket.down) / bucket.n) * 100;
  const avg = Math.round(bucket.sum / bucket.n);
  return `${day} · ${uptime.toFixed(2)}% · ${bucket.n} checks · avg ${avg}ms`;
}

/** Builds a dense, gap-free series of the last `days` UTC days. */
function alignToCalendar(daily: DayBucket[], days: number) {
  const byDate = new Map(daily.map((b) => [b.d, b]));
  const out: { day: string; bucket: DayBucket | null }[] = [];
  const today = Date.now();

  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day, bucket: byDate.get(day) ?? null });
  }
  return out;
}

export function UptimeBars({
  daily,
  days = 60,
  className,
}: {
  daily: DayBucket[];
  days?: number;
  className?: string;
}) {
  const series = alignToCalendar(daily, days);

  return (
    <div className={cn("flex items-end gap-[2px]", className)}>
      {series.map(({ day, bucket }) => (
        <div
          key={day}
          title={tooltip(day, bucket)}
          className={cn(
            "h-7 min-w-[3px] flex-1 rounded-[2px] transition-all duration-200 hover:scale-y-110 hover:brightness-125",
            barColor(bucket),
            !bucket && "opacity-40",
          )}
        />
      ))}
    </div>
  );
}

/**
 * A compact variant driven by raw checks rather than days — used on cards,
 * where the interesting window is the last few hours, not the last quarter.
 */
export function CheckBars({
  values,
  className,
}: {
  values: { t: number; s: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex items-end gap-[2px]", className)}>
      {values.map((v) => (
        <div
          key={v.t}
          title={new Date(v.t).toLocaleString()}
          className={cn(
            "h-5 min-w-[2px] flex-1 rounded-[1px]",
            v.s === "down" ? "bg-down" : v.s === "degraded" ? "bg-degraded" : "bg-up",
          )}
        />
      ))}
    </div>
  );
}
