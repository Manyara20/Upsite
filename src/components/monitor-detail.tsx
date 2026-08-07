"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { LatencyChart, StatusLegend } from "./latency-chart";
import { UptimeBars } from "./uptime-bars";
import { IncidentFeed } from "./incident-feed";
import { StatusDot } from "./status-dot";
import {
  cn,
  formatClock,
  formatMs,
  formatSince,
  formatUptime,
  STATUS_LABEL,
  STATUS_STYLE,
} from "@/lib/format";
import type { Incident, MonitorSnapshot, StreamEvent } from "@/lib/types";

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="glass rounded-xl border border-edge px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={cn("mt-1 font-mono text-xl text-ink", tone)}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-ink-faint">{hint}</div>}
    </div>
  );
}

export function MonitorDetail({
  initial,
  incidents: initialIncidents,
}: {
  initial: MonitorSnapshot;
  incidents: Incident[];
}) {
  const [monitor, setMonitor] = useState(initial);
  const [incidents, setIncidents] = useState(initialIncidents);
  const [checking, startChecking] = useTransition();

  // Same stream as the dashboard, filtered down to this one monitor.
  useEffect(() => {
    const source = new EventSource("/api/stream");

    const refetch = async () => {
      const res = await fetch(`/api/monitors/${initial.id}`, { cache: "no-store" });
      if (res.ok) setMonitor((await res.json()) as MonitorSnapshot);
    };

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as StreamEvent;

      if (event.type === "hello") {
        const fresh = event.snapshot.monitors.find((m) => m.id === initial.id);
        if (fresh) setMonitor(fresh);
        setIncidents(event.snapshot.incidents.filter((i) => i.monitorId === initial.id));
        return;
      }

      if (event.monitorId !== initial.id) return;

      if (event.type === "transition") {
        void refetch();
        setIncidents((prev) => {
          if (!event.incident) return prev;
          const rest = prev.filter((i) => i.id !== event.incident!.id);
          return [event.incident, ...rest];
        });
        return;
      }

      setMonitor((prev) => ({
        ...prev,
        state: event.state,
        recent: [...prev.recent, event.result].slice(-2880),
      }));
    };

    return () => source.close();
  }, [initial.id]);

  const style = STATUS_STYLE[monitor.state.status];

  const recheck = () =>
    startChecking(async () => {
      await fetch(`/api/check?id=${encodeURIComponent(monitor.id)}`, { method: "POST" });
      const res = await fetch(`/api/monitors/${monitor.id}`, { cache: "no-store" });
      if (res.ok) setMonitor((await res.json()) as MonitorSnapshot);
    });

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-ink-dim transition hover:text-signal"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All monitors
      </Link>

      <header className="glass bevel mt-5 rounded-2xl border border-edge p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <StatusDot status={monitor.state.status} size="lg" />
              <h1 className="truncate text-2xl font-semibold text-ink">{monitor.name}</h1>
            </div>

            <p className={cn("mt-2 text-sm font-medium", style.text)}>
              {STATUS_LABEL[monitor.state.status]}
              <span className="text-ink-faint">
                {" "}
                for {formatSince(monitor.state.since)} · checked every{" "}
                {monitor.intervalSeconds}s
              </span>
            </p>

            <p className="mt-2 flex items-center gap-1.5 font-mono text-xs text-ink-dim">
              {monitor.target}
              {monitor.url && (
                <a
                  href={monitor.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-ink-faint transition hover:text-signal"
                  aria-label="Open target in a new tab"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>

            {monitor.description && (
              <p className="mt-2 max-w-prose text-sm text-ink-dim">{monitor.description}</p>
            )}
          </div>

          <button
            type="button"
            onClick={recheck}
            disabled={checking}
            className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-abyss px-3 py-1.5 text-[11px] text-ink-dim transition hover:border-signal/40 hover:text-signal disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />
            {checking ? "Checking…" : "Check now"}
          </button>
        </div>

        {monitor.state.lastError && (
          <p className="mt-5 rounded-lg bg-down/10 px-3 py-2 font-mono text-xs text-down">
            {monitor.state.lastError}
          </p>
        )}
      </header>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="24 hours" value={formatUptime(monitor.uptime.day)} hint="uptime" />
        <Figure label="7 days" value={formatUptime(monitor.uptime.week)} hint="uptime" />
        <Figure label="30 days" value={formatUptime(monitor.uptime.month)} hint="uptime" />
        <Figure label="90 days" value={formatUptime(monitor.uptime.quarter)} hint="uptime" />
      </section>

      <section className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Average" value={formatMs(monitor.latency.avg)} hint="response time" />
        <Figure label="p95" value={formatMs(monitor.latency.p95)} hint="response time" />
        <Figure label="Fastest" value={formatMs(monitor.latency.min)} hint="response time" />
        <Figure
          label="Last check"
          value={formatClock(monitor.state.lastCheck)}
          hint={
            monitor.state.lastCode
              ? `HTTP ${monitor.state.lastCode} · ${formatMs(monitor.state.lastLatency)}`
              : formatMs(monitor.state.lastLatency)
          }
        />
      </section>

      <section className="glass bevel mt-6 rounded-2xl border border-edge p-6">
        <h2 className="text-sm font-medium text-ink">Response time</h2>
        {/* The unit lives here rather than on the axis, where a rotated label
            collides with the topmost tick. */}
        <p className="mb-4 mt-0.5 text-xs text-ink-faint">
          Milliseconds · every retained check, oldest to newest
        </p>
        <LatencyChart checks={monitor.recent} />
      </section>

      <section className="glass bevel mt-6 rounded-2xl border border-edge p-6">
        <h2 className="text-sm font-medium text-ink">Daily uptime</h2>
        <p className="mb-4 mt-0.5 text-xs text-ink-faint">
          One bar per day over the last 90 days
        </p>
        <UptimeBars daily={monitor.daily} days={90} />
        <div className="mt-4">
          <StatusLegend />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-ink">Incident history</h2>
        <p className="mb-4 mt-0.5 text-xs text-ink-faint">
          Recorded for this monitor only
        </p>
        <IncidentFeed
          incidents={incidents}
          names={{ [monitor.id]: monitor.name }}
          limit={25}
        />
      </section>

      <section className="glass mt-8 rounded-2xl border border-edge p-6">
        <h2 className="text-sm font-medium text-ink">Embeddable badges</h2>
        <p className="mb-4 mt-0.5 text-xs text-ink-faint">
          Rendered locally — no third-party badge service involved
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {["status", "uptime", "response"].map((type) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={type}
              src={`/api/badge/${monitor.id}?type=${type}`}
              alt={`${monitor.name} ${type} badge`}
              height={20}
            />
          ))}
        </div>
        <pre className="mt-4 overflow-x-auto rounded-lg border border-edge bg-void/60 p-3 font-mono text-[11px] text-ink-dim">
          {`![${monitor.name}](/api/badge/${monitor.id}?type=uptime)`}
        </pre>
      </section>
    </main>
  );
}
