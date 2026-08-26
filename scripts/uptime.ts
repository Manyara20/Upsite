import { runCheck } from "../src/lib/checker";
import { loadConfig, monitorTarget, type ResolvedMonitor, type UpsiteConfig } from "../src/lib/config";
import type { CheckResult, Incident } from "../src/lib/types";
import {
  applyCheck,
  applyIncident,
  loadDaily,
  loadHistory,
  loadIncidents,
  saveHistory,
  saveIncidents,
  type Transition,
} from "./lib/history";
import { GitHub } from "./lib/github";
import { describeFleet, publish, updateReadme } from "./lib/publish";
import { dailyFile, writeJson } from "./lib/repo";
import {
  EMOJI,
  humanDuration,
  issueBody,
  issueMarker,
  issueTitle,
  resolvedComment,
  updateComment,
} from "./lib/report";
import { notify } from "./lib/slack";

/**
 * The 5-minute check.
 *
 * Runs every monitor, folds the results into `history/`, drives the GitHub
 * issue that represents each outage, and posts to Slack. The workflow commits
 * whatever this leaves behind — the commit *is* the persistence step, so this
 * script must be safe to re-run and safe to interrupt.
 */

/** Only ever set by the caller when GitHub is unreachable; never fatal. */
let degraded = false;

function warn(context: string, err: unknown): void {
  degraded = true;
  console.error(`[upsite] ${context}:`, err instanceof Error ? err.message : err);
}

// ---------------------------------------------------------------------------
// Issue lifecycle
// ---------------------------------------------------------------------------

/**
 * Opens the incident issue, assigns it, and locks it so people outside the
 * organisation cannot comment. Returns the issue number, or undefined if
 * GitHub could not be reached — the incident is still recorded either way.
 */
async function openIssue(
  gh: GitHub,
  config: UpsiteConfig,
  monitor: ResolvedMonitor,
  incident: Incident,
  result: CheckResult,
  assignees: string[],
): Promise<{ number: number; url: string } | undefined> {
  const { labels, lock } = config.incidents;

  try {
    // An issue may already exist if a previous run committed nothing — for
    // instance when the push raced another workflow and lost.
    const existing = await gh.findOpenIncident(labels, issueMarker(monitor.id));
    if (existing) {
      console.log(`[upsite] reusing open issue #${existing.number} for ${monitor.id}`);
      return { number: existing.number, url: existing.html_url };
    }

    const issue = await gh.createIssue({
      title: issueTitle(monitor, incident.severity),
      body: issueBody(config, monitor, incident, result),
      labels,
      assignees,
    });

    if (lock) await gh.lock(issue.number).catch((err) => warn(`locking #${issue.number}`, err));

    console.log(`[upsite] opened issue #${issue.number} for ${monitor.id}`);
    return { number: issue.number, url: issue.html_url };
  } catch (err) {
    warn(`opening an issue for ${monitor.id}`, err);
    return undefined;
  }
}

/**
 * Posts a follow-up report on an open incident. Throttled, because a check
 * every 5 minutes would otherwise bury the issue in identical comments — but a
 * changed failure reason always gets through immediately, since that is the
 * part an on-call engineer actually needs to see.
 */
async function reportProgress(
  gh: GitHub,
  config: UpsiteConfig,
  monitor: ResolvedMonitor,
  incident: Incident,
  result: CheckResult,
  history: { incident?: { issue?: number; lastCommentAt?: number; lastCommentReason?: string } },
): Promise<boolean> {
  const open = history.incident;
  if (!open?.issue) return false;

  const reason = result.e ?? `slow: ${Math.round(result.ms)}ms`;
  const throttleMs = config.incidents.commentThrottleMinutes * 60_000;
  const since = result.t - (open.lastCommentAt ?? incident.startedAt);
  const reasonChanged = open.lastCommentReason !== undefined && open.lastCommentReason !== reason;

  if (!reasonChanged && since < throttleMs) return false;

  try {
    await gh.commentOnLocked(
      open.issue,
      updateComment(monitor, incident, result, result.t),
      config.incidents.lock,
    );
    open.lastCommentAt = result.t;
    open.lastCommentReason = reason;
    return true;
  } catch (err) {
    warn(`commenting on #${open.issue}`, err);
    return false;
  }
}

async function closeIssue(
  gh: GitHub,
  config: UpsiteConfig,
  monitor: ResolvedMonitor,
  incident: Incident,
  result: CheckResult,
  issue: number,
): Promise<void> {
  try {
    await gh.commentOnLocked(issue, resolvedComment(monitor, incident, result), config.incidents.lock);
    if (config.incidents.closeOnRecovery) await gh.close(issue);
    console.log(`[upsite] closed issue #${issue} for ${monitor.id}`);
  } catch (err) {
    warn(`closing #${issue}`, err);
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function announce(
  config: UpsiteConfig,
  monitor: ResolvedMonitor,
  transition: Transition,
  result: CheckResult,
  incident: Incident | undefined,
  issueUrl: string | undefined,
): Promise<void> {
  const target = monitorTarget(monitor);

  if (transition.to === "up") {
    const downtime =
      incident?.endedAt !== undefined
        ? ` after ${humanDuration(incident.endedAt - incident.startedAt)}`
        : "";
    await notify(config, {
      headline: `${EMOJI.up} ${monitor.name} recovered${downtime}`,
      detail: `\`${target}\` responded in ${Math.round(result.ms)} ms.`,
      colour: "good",
      ...(issueUrl ? { link: { text: "View incident", url: issueUrl } } : {}),
    });
    return;
  }

  if (transition.to === "down" || transition.to === "degraded") {
    await notify(config, {
      headline: `${EMOJI[transition.to]} ${monitor.name} is ${transition.to}`,
      detail: [
        `\`${target}\``,
        result.e ? `Error: \`${result.e}\`` : `Responded in ${Math.round(result.ms)} ms`,
        result.c !== undefined ? `HTTP \`${result.c}\`` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      colour: transition.to === "down" ? "danger" : "warning",
      ...(issueUrl ? { link: { text: "Open incident", url: issueUrl } } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();
  const gh = GitHub.fromEnv(config.repository.owner, config.repository.name);

  // Resolved once per run rather than per incident: it is a request each and
  // the answer does not change between two monitors failing in the same tick.
  const assignees = gh ? await gh.filterAssignees(config.incidents.assignees).catch(() => []) : [];

  const incidents = loadIncidents();
  const active = config.monitors.filter((m) => !m.paused);

  const results = await Promise.all(
    active.map(async (m) => ({ monitor: m, result: await runCheck(m) })),
  );

  for (const { monitor, result } of results) {
    const history = loadHistory(monitor);
    const daily = loadDaily(monitor.id);
    const { dayRolled, transition } = applyCheck(config, monitor, history, daily, result);

    if (transition) {
      const incident = applyIncident(history, incidents, transition, result);

      if (transition.to === "down" || transition.to === "degraded") {
        if (gh && incident && history.incident && !history.incident.issue) {
          const opened = await openIssue(gh, config, monitor, incident, result, assignees);
          if (opened) {
            history.incident.issue = opened.number;
            history.incident.issueUrl = opened.url;
            history.incident.lastCommentAt = result.t;
            history.incident.lastCommentReason = result.e ?? `slow: ${Math.round(result.ms)}ms`;
            incident.issue = opened.number;
            incident.issueUrl = opened.url;
          }
        }
        await announce(config, monitor, transition, result, incident, history.incident?.issueUrl);
      } else if (transition.from === "down" || transition.from === "degraded") {
        const issue = history.incident?.issue;
        if (gh && incident && issue) {
          await closeIssue(gh, config, monitor, incident, result, issue);
        }
        await announce(config, monitor, transition, result, incident, history.incident?.issueUrl);
        // The incident is closed; the monitor's record goes back to clean.
        delete history.incident;
      }

      console.log(
        `[upsite] ${monitor.id}: ${transition.from} → ${transition.to}` +
          (result.e ? ` (${result.e})` : ` (${Math.round(result.ms)}ms)`),
      );
    } else if (history.incident && (history.status === "down" || history.status === "degraded")) {
      // Still broken. Keep the issue current without opening a second one.
      const incident = incidents.find((i) => i.id === history.incident!.id);
      if (gh && incident) await reportProgress(gh, config, monitor, incident, result, history);
    }

    saveHistory(history);
    // daily.json only changes when the UTC day rolls over, so leave it alone
    // the other 287 times a day and keep the commit to one small file.
    if (dayRolled) writeJson(dailyFile(monitor.id), daily);
  }

  saveIncidents(incidents, config.retention.incidents);

  const { snapshot } = publish(config);
  updateReadme(snapshot.monitors);

  // Read by the workflow to build the commit message.
  console.log(`::notice::${describeFleet(snapshot)}`);
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `summary=${describeFleet(snapshot)}\n`);
  }

  if (degraded) {
    console.warn("[upsite] finished with GitHub API errors — see above");
  }
}

main().catch((err) => {
  // A crash here means no results were committed at all, which is worth
  // failing the workflow over: silence would look exactly like "all up".
  console.error("[upsite] uptime run failed:", err);
  process.exit(1);
});
