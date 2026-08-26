import type { CheckResult, Incident, MonitorSnapshot, MonitorStatus } from "../../src/lib/types";
import type { ResolvedMonitor, UpsiteConfig } from "../../src/lib/config";

/**
 * The words. Issue titles, issue bodies, incident comments and Slack messages
 * all come from here so an outage reads the same wherever it surfaces.
 */

export const EMOJI: Record<MonitorStatus, string> = {
  up: "🟩",
  degraded: "🟨",
  down: "🟥",
  paused: "⬜",
  pending: "⬛",
};

export function humanDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h} hour${h === 1 ? "" : "s"}`;
}

export function issueTitle(m: ResolvedMonitor, severity: "down" | "degraded"): string {
  return severity === "down" ? `🛑 ${m.name} is down` : `⚠️ ${m.name} is degraded`;
}

/**
 * A hidden marker in the issue body. It survives edits and renames, so the
 * issue can always be found again even if `history/<id>.yml` is lost.
 */
export function issueMarker(id: string): string {
  return `<!-- upsite:monitor:${id} -->`;
}

function detail(result: CheckResult): string {
  const parts = [`Response time: \`${Math.round(result.ms)} ms\``];
  if (result.c !== undefined) parts.push(`HTTP status: \`${result.c}\``);
  if (result.e) parts.push(`Error: \`${result.e}\``);
  return parts.join("\n- ");
}

export function issueBody(
  config: UpsiteConfig,
  m: ResolvedMonitor,
  incident: Incident,
  result: CheckResult,
): string {
  const started = new Date(incident.startedAt).toISOString();
  const site = config.site.url ? `\n\n[View on the status page](${config.site.url})` : "";

  return `${issueMarker(m.id)}
**${m.name}** (${m.type === "http" ? m.url : `${m.host}:${m.port}`}) is **${incident.severity}**.

- Started: \`${started}\`
- ${detail(result)}

The check runs every ${Math.round(m.intervalSeconds / 60)} minutes. This issue is
updated as the incident develops and closes on its own once ${m.name} recovers.${site}`;
}

/** A follow-up posted while the outage is still open. */
export function updateComment(
  m: ResolvedMonitor,
  incident: Incident,
  result: CheckResult,
  now: number,
): string {
  return `### ${EMOJI[incident.severity]} Still ${incident.severity} — ${humanDuration(
    now - incident.startedAt,
  )} so far

- Checked: \`${new Date(now).toISOString()}\`
- ${detail(result)}`;
}

/** The closing report. */
export function resolvedComment(
  m: ResolvedMonitor,
  incident: Incident,
  result: CheckResult,
): string {
  const ended = incident.endedAt ?? result.t;
  return `### 🟩 Resolved

**${m.name}** is back up after **${humanDuration(ended - incident.startedAt)}** of downtime.

- Recovered: \`${new Date(ended).toISOString()}\`
- ${detail(result)}

Closing this incident automatically.`;
}

/** One line for the README status table. */
export function summaryRow(m: MonitorSnapshot, graphPath: string): string {
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(2)}%`);
  const link = m.url ? `[${m.name}](${m.url})` : `${m.name} (\`${m.target}\`)`;
  const rt = m.state.lastLatency;

  return `| ${EMOJI[m.state.status]} ${link} | ${m.state.status} | ${
    rt === undefined ? "—" : `${Math.round(rt)} ms`
  } | ${pct(m.uptime.day)} | ${pct(m.uptime.week)} | ${pct(m.uptime.month)} | ${pct(
    m.uptime.quarter,
  )} | [graph](${graphPath}) |`;
}
