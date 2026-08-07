"use client";

import { motion } from "framer-motion";
import { Activity, RefreshCw, WifiOff } from "lucide-react";
import { StatusDot } from "./status-dot";
import { cn, formatClock, STATUS_STYLE } from "@/lib/format";
import type { StatusSnapshot } from "@/lib/types";

/**
 * The masthead. The overall state is the hero — one number-sized statement,
 * with the per-status counts as supporting figures rather than a chart.
 */

const OVERALL_HEADLINE: Record<StatusSnapshot["overall"], string> = {
  up: "All systems operational",
  degraded: "Degraded performance",
  down: "Active outage",
  paused: "Monitoring paused",
  pending: "Awaiting first checks",
};

function ConnectionPill({ connection }: { connection: "connecting" | "live" | "offline" }) {
  if (connection === "offline") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-down/30 bg-down/10 px-2.5 py-1 text-[11px] text-down">
        <WifiOff className="h-3 w-3" />
        Reconnecting
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
        connection === "live"
          ? "border-signal/30 bg-signal/10 text-signal"
          : "border-edge bg-abyss text-ink-faint",
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {connection === "live" && (
          <span className="animate-pulse-ring absolute inline-flex h-full w-full rounded-full bg-signal" />
        )}
        <span
          className={cn(
            "relative inline-flex h-1.5 w-1.5 rounded-full",
            connection === "live" ? "bg-signal" : "bg-ink-faint",
          )}
        />
      </span>
      {connection === "live" ? "Live" : "Connecting"}
    </span>
  );
}

export function StatusHeader({
  snapshot,
  connection,
  onCheckAll,
  checking,
}: {
  snapshot: StatusSnapshot;
  connection: "connecting" | "live" | "offline";
  onCheckAll: () => void;
  checking: boolean;
}) {
  const style = STATUS_STYLE[snapshot.overall];

  const figures = [
    { label: "Operational", value: snapshot.counts.up, tone: "text-up" },
    { label: "Degraded", value: snapshot.counts.degraded, tone: "text-degraded" },
    { label: "Down", value: snapshot.counts.down, tone: "text-down" },
    { label: "Paused", value: snapshot.counts.paused, tone: "text-paused" },
  ];

  return (
    <header className="relative">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Activity className="h-5 w-5 text-signal" />
          <span className="text-sm font-semibold tracking-[0.2em] text-ink uppercase">
            {snapshot.site.name}
          </span>
          {snapshot.site.tagline && (
            <span className="hidden text-xs text-ink-faint sm:inline">
              {snapshot.site.tagline}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <ConnectionPill connection={connection} />
          <button
            type="button"
            onClick={onCheckAll}
            disabled={checking}
            className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-abyss px-3 py-1 text-[11px] text-ink-dim transition hover:border-signal/40 hover:text-signal disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />
            {checking ? "Checking…" : "Check all"}
          </button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="glass bevel mt-6 overflow-hidden rounded-3xl border border-edge p-8"
      >
        {/* A single sweep of light across the banner — the one piece of motion
            that says "this page is live" without competing with the data. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
          <div className="animate-sweep h-px w-1/3 bg-gradient-to-r from-transparent via-signal to-transparent" />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <div className="flex items-center gap-3">
              <StatusDot status={snapshot.overall} size="lg" />
              <h1
                className={cn(
                  "text-2xl font-semibold tracking-tight sm:text-3xl",
                  style.text,
                  style.glow,
                )}
              >
                {OVERALL_HEADLINE[snapshot.overall]}
              </h1>
            </div>
            <p className="mt-2 text-sm text-ink-dim">
              Monitoring {snapshot.monitors.length} endpoint
              {snapshot.monitors.length === 1 ? "" : "s"} · updated{" "}
              <span className="font-mono">{formatClock(snapshot.generatedAt)}</span>
            </p>
          </div>

          <dl className="flex gap-8">
            {figures.map((figure) => (
              <div key={figure.label}>
                <dd className={cn("font-mono text-2xl", figure.value > 0 ? figure.tone : "text-ink-faint")}>
                  {figure.value}
                </dd>
                <dt className="mt-1 text-[10px] uppercase tracking-wider text-ink-faint">
                  {figure.label}
                </dt>
              </div>
            ))}
          </dl>
        </div>
      </motion.div>
    </header>
  );
}
