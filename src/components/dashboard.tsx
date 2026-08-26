"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { StatusHeader } from "./status-header";
import { MonitorCard } from "./monitor-card";
import { IncidentFeed } from "./incident-feed";
import { UptimeBars } from "./uptime-bars";
import { StatusLegend } from "./latency-chart";
import { useStatus } from "@/hooks/use-status";
import { cn, formatUptime } from "@/lib/format";
import { issuesUrl, type Source } from "@/lib/source";
import type { MonitorStatus, StatusSnapshot } from "@/lib/types";

type StatusFilter = "all" | MonitorStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "up", label: "Operational" },
  { value: "degraded", label: "Degraded" },
  { value: "down", label: "Down" },
  { value: "paused", label: "Paused" },
];

export function Dashboard({
  initial,
  source,
  incidentLabels,
}: {
  /** Baked into the export at build time, so the first paint is never empty. */
  initial: StatusSnapshot;
  source: Source;
  incidentLabels: string[];
}) {
  const { snapshot, connection, refresh, refreshing } = useStatus(initial, source);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [tag, setTag] = useState<string | null>(null);

  const monitors = snapshot.monitors;

  const tags = useMemo(
    () => [...new Set(monitors.flatMap((m) => m.tags))].sort(),
    [monitors],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return monitors.filter((m) => {
      if (status !== "all" && m.state.status !== status) return false;
      if (tag && !m.tags.includes(tag)) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.target.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [monitors, query, status, tag]);

  const names = useMemo(
    () => Object.fromEntries(monitors.map((m) => [m.id, m.name])),
    [monitors],
  );

  /** Fleet-wide uptime, weighted by checks so a noisy monitor can't dominate. */
  const fleetUptime = useMemo(() => {
    let total = 0;
    let down = 0;
    for (const m of monitors) {
      for (const bucket of m.daily.slice(-90)) {
        total += bucket.n;
        down += bucket.down;
      }
    }
    return total === 0 ? null : (total - down) / total;
  }, [monitors]);

  return (
    <main id="main" className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8">
      <StatusHeader
        snapshot={snapshot}
        connection={connection}
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        source={source}
      />

      {/* Filters live in one row above the data, never beside it. */}
      <section className="mt-8 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter monitors…"
            aria-label="Filter monitors"
            className="w-full rounded-xl border border-edge bg-abyss/70 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-signal/50 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              aria-pressed={status === filter.value}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
                status === filter.value
                  ? "border-signal/40 bg-signal/10 text-signal"
                  : "border-edge bg-abyss/60 text-ink-dim hover:text-ink",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTag(tag === t ? null : t)}
                aria-pressed={tag === t}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
                  tag === t
                    ? "border-signal/40 bg-signal/10 text-signal"
                    : "border-edge bg-abyss/60 text-ink-dim hover:text-ink",
                )}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((monitor, i) => (
          <MonitorCard key={monitor.id} monitor={monitor} index={i} />
        ))}
      </section>

      {visible.length === 0 && (
        <p className="mt-10 text-center text-sm text-ink-faint">
          {monitors.length === 0
            ? "No monitors configured yet."
            : "No monitors match this filter."}
        </p>
      )}

      <section className="mt-12 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="glass bevel rounded-2xl border border-edge p-6">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium tracking-wide text-ink">Fleet uptime</h2>
              <p className="mt-0.5 text-xs text-ink-faint">
                Last 90 days across every monitor
              </p>
            </div>
            <span className="font-mono text-2xl text-ink">{formatUptime(fleetUptime)}</span>
          </div>

          <div className="mt-5 space-y-3">
            {monitors.map((monitor) => (
              <div key={monitor.id} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-3">
                <span className="truncate text-xs text-ink-dim" title={monitor.name}>
                  {monitor.name}
                </span>
                <UptimeBars daily={monitor.daily} days={45} />
                <span className="text-right font-mono text-[11px] text-ink-dim">
                  {formatUptime(monitor.uptime.quarter ?? monitor.uptime.day)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-5 border-t border-edge/70 pt-4">
            <StatusLegend />
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium tracking-wide text-ink">Incident log</h2>
            <a
              href={issuesUrl(source, incidentLabels)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[11px] text-ink-faint transition hover:text-signal"
            >
              All issues
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <p className="mb-4 mt-0.5 text-xs text-ink-faint">
            Each outage opens a GitHub issue, is reported on in its comments, and closes
            itself on recovery
          </p>
          <IncidentFeed incidents={snapshot.incidents} names={names} />
        </div>
      </section>

      <footer className="mt-14 border-t border-edge/70 pt-6 text-[11px] text-ink-faint">
        <p>
          Checked every 5 minutes by GitHub Actions · results committed to{" "}
          <code className="text-ink-dim">
            {source.owner}/{source.name}
          </code>{" "}
          · configured in <code className="text-ink-dim">upsite.config.yaml</code>
        </p>
      </footer>
    </main>
  );
}
