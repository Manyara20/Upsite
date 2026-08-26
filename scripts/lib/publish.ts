import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { UpsiteConfig } from "../../src/lib/config";
import type { MonitorReport, MonitorSnapshot, StatusSnapshot } from "../../src/lib/types";
import {
  buildMonitorSnapshot,
  buildSnapshot,
  loadDaily,
  loadHistory,
  loadIncidents,
  loadSamples,
} from "./history";
import { API_DIR, ROOT, writeJson } from "./repo";
import { EMOJI, summaryRow } from "./report";

/**
 * Derivation. Everything under `api/`, plus the README table, is a pure
 * function of `history/` — so it is always rewritten wholesale rather than
 * patched, and a corrupted output file fixes itself on the next run.
 *
 * Monitors marked `secure` are checked and alerted on like any other, but are
 * omitted here so they never reach the status site. Their `history/` file is
 * still committed — `secure` controls what is published, not what is stored.
 */

export interface Published {
  /** Every monitor, secure ones included — for alerting, not for publishing. */
  all: MonitorSnapshot[];
  /** What actually got written to `api/`. */
  snapshot: StatusSnapshot;
}

function shieldColour(status: string): string {
  return status === "up" ? "brightgreen" : status === "degraded" ? "yellow" : status === "down" ? "red" : "lightgrey";
}

function uptimeColour(ratio: number | null): string {
  if (ratio === null) return "lightgrey";
  if (ratio >= 0.999) return "brightgreen";
  if (ratio >= 0.99) return "green";
  if (ratio >= 0.95) return "yellow";
  return "red";
}

function latencyColour(ms: number | null): string {
  if (ms === null) return "lightgrey";
  if (ms < 300) return "brightgreen";
  if (ms < 800) return "green";
  if (ms < 2000) return "yellow";
  return "red";
}

/** Reads every monitor's committed state and rebuilds the published view. */
export function publish(config: UpsiteConfig): Published {
  const incidents = loadIncidents();

  const all = config.monitors.map((m) =>
    buildMonitorSnapshot(m, loadHistory(m), loadDaily(m.id), loadSamples(m.id)),
  );

  const publicIds = new Set(all.filter((m) => !m.secure).map((m) => m.id));
  const publicMonitors = all.filter((m) => publicIds.has(m.id));
  const publicIncidents = incidents.filter((i) => publicIds.has(i.monitorId));

  const snapshot = buildSnapshot(config, publicMonitors, publicIncidents);

  // The dashboard's first paint. Trimmed of the per-monitor detail that only
  // the detail pages need, so the front page stays a single small request.
  writeJson(path.join(API_DIR, "summary.json"), {
    ...snapshot,
    monitors: publicMonitors.map((m) => ({ ...m, recent: m.recent.slice(-96) })),
  });

  for (const m of publicMonitors) {
    // One file per monitor, holding the full series the detail page charts
    // together with that monitor's slice of the incident log.
    const report: MonitorReport = {
      ...m,
      incidents: incidents.filter((i) => i.monitorId === m.id),
    };
    writeJson(path.join(API_DIR, `${m.id}.json`), report);

    // shields.io endpoint badges, so a README or a docs page elsewhere can
    // show this monitor's state without knowing anything about Upsite.
    writeJson(path.join(API_DIR, m.id, "shields.json"), {
      schemaVersion: 1,
      label: m.name,
      message: m.state.status,
      color: shieldColour(m.state.status),
    });
    writeJson(path.join(API_DIR, m.id, "uptime.json"), {
      schemaVersion: 1,
      label: "uptime",
      message: m.uptime.quarter === null ? "unknown" : `${(m.uptime.quarter * 100).toFixed(2)}%`,
      color: uptimeColour(m.uptime.quarter),
    });
    writeJson(path.join(API_DIR, m.id, "response-time.json"), {
      schemaVersion: 1,
      label: "response time",
      message: m.latency.avg === null ? "unknown" : `${m.latency.avg} ms`,
      color: latencyColour(m.latency.avg),
    });
  }

  return { all, snapshot };
}

const TABLE_START = "<!-- upsite:status:start -->";
const TABLE_END = "<!-- upsite:status:end -->";

/**
 * Rewrites the status table between the markers in README.md. The markers are
 * required: silently appending to a README nobody prepared would be worse than
 * doing nothing, so a missing pair is a warning and a no-op.
 */
export function updateReadme(monitors: MonitorSnapshot[]): boolean {
  const file = path.join(ROOT, "README.md");
  if (!existsSync(file)) return false;

  const readme = readFileSync(file, "utf8");
  const from = readme.indexOf(TABLE_START);
  const to = readme.indexOf(TABLE_END);
  if (from === -1 || to === -1 || to < from) {
    console.warn(`[upsite] README.md has no ${TABLE_START} / ${TABLE_END} pair — skipping table`);
    return false;
  }

  const rows = monitors
    .filter((m) => !m.secure)
    .map((m) => summaryRow(m, `./graphs/${m.id}.svg`));

  const table = [
    "",
    "| Monitor | Status | Response | 24h | 7d | 30d | 90d | Graph |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    `_Updated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC by [the uptime workflow](../../actions/workflows/uptime.yml)._`,
    "",
  ].join("\n");

  const next = `${readme.slice(0, from + TABLE_START.length)}\n${table}${readme.slice(to)}`;
  if (next === readme) return false;
  writeFileSync(file, next);
  return true;
}

/** Overall line used in commit messages and Slack digests. */
export function describeFleet(snapshot: StatusSnapshot): string {
  const { counts } = snapshot;
  const parts: string[] = [];
  if (counts.up) parts.push(`${counts.up} up`);
  if (counts.degraded) parts.push(`${counts.degraded} degraded`);
  if (counts.down) parts.push(`${counts.down} down`);
  if (counts.paused) parts.push(`${counts.paused} paused`);
  if (counts.pending) parts.push(`${counts.pending} pending`);
  return `${EMOJI[snapshot.overall]} ${parts.join(", ") || "no monitors"}`;
}
