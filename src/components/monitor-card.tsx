"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, Radio } from "lucide-react";
import { Sparkline } from "./sparkline";
import { StatusDot } from "./status-dot";
import {
  cn,
  formatMs,
  formatSince,
  formatUptime,
  STATUS_LABEL,
  STATUS_STYLE,
} from "@/lib/format";
import type { MonitorSnapshot } from "@/lib/types";

/** One labelled figure. The number leads; the caption sits under it, recessive. */
function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className={cn("truncate font-mono text-sm text-ink", tone)}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-ink-faint">
        {label}
      </div>
    </div>
  );
}

export function MonitorCard({
  monitor,
  index,
  href,
}: {
  monitor: MonitorSnapshot;
  index: number;
  /**
   * Detail page for this monitor, or null when there is none. Protected
   * monitors have no page: the export only generates routes for monitors whose
   * data is published in the clear.
   */
  href?: string | null;
}) {
  const style = STATUS_STYLE[monitor.state.status];
  const { state } = monitor;
  const target = href === undefined ? `/monitor/${monitor.id}` : href;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4), ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "glass bevel group relative overflow-hidden rounded-2xl border p-5",
        "transition-colors duration-300 hover:border-edge-bright",
        style.border,
      )}
    >
      {/* A faint wash of the status color, so the card reads at a glance. */}
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 opacity-[0.55]", style.bg)}
      />

      <div className="relative">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot status={state.status} />
              <h3 className="truncate text-[15px] font-medium text-ink">{monitor.name}</h3>
            </div>

            {/* Status is always written out — never conveyed by color alone. */}
            <p className={cn("mt-1 text-xs font-medium", style.text)}>
              {STATUS_LABEL[state.status]}
              <span className="text-ink-faint"> · {formatSince(state.since)}</span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {target !== null && (
              <Link
                href={target}
                aria-label={`Open ${monitor.name} details`}
                className="rounded-lg p-1.5 text-ink-faint transition hover:bg-edge hover:text-signal"
              >
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </header>

        <p className="mt-3 truncate font-mono text-[11px] text-ink-dim" title={monitor.target}>
          {monitor.kind === "tcp" && (
            <Radio className="mr-1 inline h-3 w-3 align-[-2px] text-ink-faint" />
          )}
          {monitor.target}
        </p>

        {/* Latency is a measure, not a state, so it wears the neutral signal
            accent — the same hue as the detail chart. Status stays on the dot,
            the label, and the red markers for failed checks. */}
        <div className="mt-4">
          <Sparkline checks={monitor.recent} />
        </div>

        <div className="mt-4 grid grid-cols-4 gap-3 border-t border-edge/70 pt-3">
          <Stat
            label="24h"
            value={formatUptime(monitor.uptime.day)}
            tone={monitor.uptime.day !== null && monitor.uptime.day < 1 ? style.text : undefined}
          />
          <Stat label="30d" value={formatUptime(monitor.uptime.month)} />
          <Stat label="avg" value={formatMs(monitor.latency.avg)} />
          <Stat label="p95" value={formatMs(monitor.latency.p95)} />
        </div>

        {state.lastError && (
          <p className="mt-3 truncate rounded-lg bg-down/10 px-2.5 py-1.5 font-mono text-[11px] text-down">
            {state.lastError}
          </p>
        )}

        {monitor.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {monitor.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-edge bg-abyss/60 px-1.5 py-0.5 text-[10px] tracking-wide text-ink-faint"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.article>
  );
}
