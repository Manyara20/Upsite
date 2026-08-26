import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getConfig, monitorTarget, type UpsiteConfig } from "./config";
import type { MonitorReport, MonitorSnapshot, MonitorStatus, StatusSnapshot } from "./types";

/**
 * Build-time data loading. Runs during `next build` only — never in a browser.
 *
 * The export is baked with whatever the workflow had committed at build time,
 * so the page paints real data on first frame (and offline, from the service
 * worker cache) before the client refreshes it from the GitHub API.
 */

const ROOT = process.cwd();

function readApi<T>(file: string): T | null {
  const full = path.join(ROOT, "api", file);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, "utf8")) as T;
  } catch {
    return null;
  }
}

/** A monitor that exists in config but has never been checked. */
function pending(config: UpsiteConfig, id: string): MonitorSnapshot {
  const m = config.monitors.find((x) => x.id === id)!;
  const status: MonitorStatus = m.paused ? "paused" : "pending";

  return {
    id: m.id,
    name: m.name,
    kind: m.type,
    target: monitorTarget(m),
    url: m.type === "http" ? m.url : undefined,
    tags: m.tags,
    description: m.description,
    secure: m.secure,
    intervalSeconds: m.intervalSeconds,
    state: { status, since: 0, consecutiveFailures: 0 },
    recent: [],
    daily: [],
    uptime: { day: null, week: null, month: null, quarter: null },
    latency: { avg: null, p95: null, min: null, max: null },
  };
}

export function buildSource(config: UpsiteConfig = getConfig()) {
  return {
    owner: config.repository.owner,
    name: config.repository.name,
    branch: config.repository.branch,
  };
}

/**
 * The snapshot baked into the export. Falls back to a fully "pending" fleet so
 * a freshly cloned repository still builds and still renders every monitor.
 */
export function buildSnapshot(): StatusSnapshot {
  const config = getConfig();
  const stored = readApi<StatusSnapshot>("summary.json");
  if (stored) return stored;

  const monitors = config.monitors.filter((m) => !m.secure).map((m) => pending(config, m.id));
  const counts: Record<MonitorStatus, number> = {
    up: 0,
    degraded: 0,
    down: 0,
    paused: 0,
    pending: 0,
  };
  for (const m of monitors) counts[m.state.status]++;

  return {
    site: { name: config.site.name, tagline: config.site.tagline, url: config.site.url },
    repository: buildSource(config),
    overall: "pending",
    generatedAt: 0,
    monitors,
    incidents: [],
    counts,
  };
}

export function buildMonitor(id: string): MonitorReport {
  const stored = readApi<MonitorReport>(`${id}.json`);
  if (stored) return { ...stored, incidents: stored.incidents ?? [] };

  return { ...pending(getConfig(), id), incidents: [] };
}

/** Public monitors only — a secure monitor gets no page and no data file. */
export function publicMonitorIds(): string[] {
  return getConfig()
    .monitors.filter((m) => !m.secure)
    .map((m) => m.id);
}
