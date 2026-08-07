"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { Globe, Lock, LockOpen, Search, ShieldCheck } from "lucide-react";
import { StatusHeader } from "./status-header";
import { MonitorCard } from "./monitor-card";
import { IncidentFeed } from "./incident-feed";
import { UptimeBars } from "./uptime-bars";
import { StatusLegend } from "./latency-chart";
import { SecureGate } from "./secure-gate";
import { AddMonitorDialog } from "./add-monitor-dialog";
import { useLiveStatus } from "@/hooks/use-live-status";
import { cn, formatUptime } from "@/lib/format";
import type { MonitorSnapshot, MonitorStatus, StatusSnapshot } from "@/lib/types";

type StatusFilter = "all" | MonitorStatus;
type Tab = "public" | "secure";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "up", label: "Operational" },
  { value: "degraded", label: "Degraded" },
  { value: "down", label: "Down" },
  { value: "paused", label: "Paused" },
];

export function Dashboard({
  initial,
  secure,
}: {
  initial: StatusSnapshot;
  secure: { configured: boolean; unlocked: boolean };
}) {
  // Bumping this reopens the SSE connection, which is how a freshly unlocked
  // session starts receiving secure monitors.
  const [reconnectKey, setReconnectKey] = useState(0);
  const [unlocked, setUnlocked] = useState(secure.unlocked);
  const [tab, setTab] = useState<Tab>("public");

  const { snapshot, connection, refresh, checkAll } = useLiveStatus(initial, reconnectKey);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();

  const publicMonitors = useMemo(
    () => snapshot.monitors.filter((m) => !m.secure),
    [snapshot.monitors],
  );
  const secureMonitors = useMemo(
    () => snapshot.monitors.filter((m) => m.secure),
    [snapshot.monitors],
  );

  const source = tab === "secure" ? secureMonitors : publicMonitors;

  const tags = useMemo(
    () => [...new Set(source.flatMap((m) => m.tags))].sort(),
    [source],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source.filter((m) => {
      if (status !== "all" && m.state.status !== status) return false;
      if (tag && !m.tags.includes(tag)) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.target.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [source, query, status, tag]);

  const names = useMemo(
    () => Object.fromEntries(snapshot.monitors.map((m) => [m.id, m.name])),
    [snapshot.monitors],
  );

  /** Fleet-wide uptime, weighted by checks so a noisy monitor can't dominate. */
  const fleetUptime = useMemo(() => {
    let total = 0;
    let down = 0;
    for (const m of publicMonitors) {
      for (const bucket of m.daily.slice(-90)) {
        total += bucket.n;
        down += bucket.down;
      }
    }
    return total === 0 ? null : (total - down) / total;
  }, [publicMonitors]);

  const runCheck = (id?: string) => startChecking(() => void checkAll(id));

  const afterUnlock = useCallback(() => {
    setUnlocked(true);
    setReconnectKey((k) => k + 1);
    void refresh();
  }, [refresh]);

  const lock = useCallback(async () => {
    await fetch("/api/secure", { method: "DELETE" });
    setUnlocked(false);
    setTag(null);
    setReconnectKey((k) => k + 1);
    void refresh();
  }, [refresh]);

  const onAdded = useCallback(() => {
    setReconnectKey((k) => k + 1);
    void refresh();
  }, [refresh]);

  const showGate = tab === "secure" && !unlocked;

  const tabs: { value: Tab; label: string; icon: typeof Globe; count: number }[] = [
    { value: "public", label: "Public", icon: Globe, count: publicMonitors.length },
    {
      value: "secure",
      label: "Secure",
      icon: unlocked ? LockOpen : Lock,
      count: unlocked ? secureMonitors.length : 0,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8">
      <StatusHeader
        snapshot={snapshot}
        connection={connection}
        onCheckAll={() => runCheck()}
        checking={checking}
      />

      <nav className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5" role="tablist" aria-label="Monitor groups">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => {
                  setTab(t.value);
                  setTag(null);
                }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs transition",
                  active
                    ? "border-signal/40 bg-signal/10 text-signal"
                    : "border-edge bg-abyss/60 text-ink-dim hover:text-ink",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {t.count > 0 && (
                  <span className="rounded-md bg-edge px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {tab === "secure" && unlocked && (
            <button
              type="button"
              onClick={lock}
              className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-abyss px-3 py-1 text-[11px] text-ink-dim transition hover:border-down/40 hover:text-down"
            >
              <Lock className="h-3 w-3" />
              Lock
            </button>
          )}
          {!showGate && (
            <AddMonitorDialog
              canAddSecure={unlocked}
              defaultSecure={tab === "secure"}
              onAdded={onAdded}
            />
          )}
        </div>
      </nav>

      {showGate ? (
        <SecureGate configured={secure.configured} onUnlocked={afterUnlock} />
      ) : (
        <>
          {tab === "secure" && (
            <p className="mt-5 flex items-center gap-2 rounded-xl border border-signal/20 bg-signal/5 px-4 py-2.5 text-xs text-ink-dim">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-signal" />
              These monitors are hidden from the public dashboard, the badges and the
              live stream until unlocked.
            </p>
          )}

          {/* Filters live in one row above the data, never beside it. */}
          <section className="mt-6 flex flex-wrap items-center gap-3">
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
            {visible.map((monitor: MonitorSnapshot, i: number) => (
              <MonitorCard key={monitor.id} monitor={monitor} index={i} onRecheck={runCheck} />
            ))}
          </section>

          {visible.length === 0 && (
            <p className="mt-10 text-center text-sm text-ink-faint">
              {source.length === 0
                ? tab === "secure"
                  ? "No secure monitors yet. Add one to get started."
                  : "No monitors configured yet."
                : "No monitors match this filter."}
            </p>
          )}
        </>
      )}

      <section className="mt-12 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="glass bevel rounded-2xl border border-edge p-6">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium tracking-wide text-ink">Fleet uptime</h2>
              <p className="mt-0.5 text-xs text-ink-faint">
                Last 90 days across all public monitors
              </p>
            </div>
            <span className="font-mono text-2xl text-ink">{formatUptime(fleetUptime)}</span>
          </div>

          <div className="mt-5 space-y-3">
            {publicMonitors.map((monitor) => (
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
          <h2 className="text-sm font-medium tracking-wide text-ink">Incident log</h2>
          <p className="mb-4 mt-0.5 text-xs text-ink-faint">
            Opened when a monitor crosses its failure threshold, closed on recovery
          </p>
          <IncidentFeed incidents={snapshot.incidents} names={names} />
        </div>
      </section>

      <footer className="mt-14 border-t border-edge/70 pt-6 text-[11px] text-ink-faint">
        <p>
          Upsite · no database — state lives in <code className="text-ink-dim">.data/</code>,
          configuration in <code className="text-ink-dim">upsite.config.yaml</code>
        </p>
      </footer>
    </main>
  );
}
