import { monitorTarget, type ResolvedMonitor, type UpsiteConfig } from "../../src/lib/config";
import type {
  CheckResult,
  DayBucket,
  Health,
  Incident,
  MonitorHistory,
  MonitorSnapshot,
  MonitorStatus,
  StatusSnapshot,
} from "../../src/lib/types";
import {
  dailyFile,
  historyFile,
  incidentsFile,
  readJson,
  readYamlFile,
  responseFile,
  writeJson,
  writeYamlFile,
} from "./repo";

/**
 * The state machine, ported from the old in-process store onto files that live
 * in git. Same debouncing, same rollups — the difference is that every
 * transition now has to survive a process that exits after one check.
 */

export interface Transition {
  monitorId: string;
  from: MonitorStatus;
  to: MonitorStatus;
  incident?: Incident;
}

export function utcDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function emptyBucket(d: string): DayBucket {
  return { d, n: 0, down: 0, deg: 0, sum: 0, max: 0 };
}

// ---------------------------------------------------------------------------
// Reading and writing one monitor's record
// ---------------------------------------------------------------------------

export function loadHistory(m: ResolvedMonitor): MonitorHistory {
  const now = Date.now();
  const seeded: MonitorHistory = {
    id: m.id,
    name: m.name,
    target: monitorTarget(m),
    status: m.paused ? "paused" : "pending",
    since: new Date(now).toISOString(),
    lastUpdated: new Date(now).toISOString(),
    consecutiveFailures: 0,
    today: emptyBucket(utcDay(now)),
    window: emptyBucket(new Date(now).toISOString()),
  };

  const stored = readYamlFile<MonitorHistory | null>(historyFile(m.id), null);
  if (!stored) return seeded;

  // The config is authoritative for identity; the file is authoritative for
  // state. Renaming a monitor in YAML should not reset its history.
  return {
    ...seeded,
    ...stored,
    name: m.name,
    target: monitorTarget(m),
    today: stored.today ?? seeded.today,
    window: stored.window ?? seeded.window,
  };
}

export function saveHistory(h: MonitorHistory): void {
  writeYamlFile(historyFile(h.id), h);
}

export function loadDaily(id: string): DayBucket[] {
  return readJson<DayBucket[]>(dailyFile(id), []);
}

export function loadSamples(id: string): CheckResult[] {
  return readJson<CheckResult[]>(responseFile(id), []);
}

export function saveSamples(id: string, samples: CheckResult[], cap: number): void {
  writeJson(responseFile(id), samples.slice(-cap));
}

export function openWindow(at: number): DayBucket {
  return emptyBucket(new Date(at).toISOString());
}

/**
 * Turns an accumulated window into the one sample that gets committed: the
 * mean latency over the window, marked down if anything in it failed and
 * degraded if anything in it was slow.
 */
export function sampleFromWindow(window: DayBucket, at: number): CheckResult | null {
  if (window.n === 0) return null;
  return {
    t: at,
    s: window.down > 0 ? "down" : window.deg > 0 ? "degraded" : "up",
    ms: Math.round(window.sum / window.n),
  };
}

export function loadIncidents(): Incident[] {
  return readJson<Incident[]>(incidentsFile(), []);
}

export function saveIncidents(incidents: Incident[], cap: number): void {
  writeJson(incidentsFile(), incidents.slice(0, cap));
}

// ---------------------------------------------------------------------------
// Applying a check
// ---------------------------------------------------------------------------

/**
 * Folds one check into a monitor's record and returns the transition it caused,
 * if any. `daily` is mutated in place: the caller writes it back only when the
 * UTC day has actually rolled over, so the common case touches one small file.
 */
export function applyCheck(
  config: UpsiteConfig,
  monitor: ResolvedMonitor,
  history: MonitorHistory,
  daily: DayBucket[],
  result: CheckResult,
): { history: MonitorHistory; daily: DayBucket[]; dayRolled: boolean; transition: Transition | null } {
  const previous = history.status;
  const day = utcDay(result.t);

  // --- daily rollup -------------------------------------------------------
  // `today` accumulates in the YAML so the 5-minute resolution is not lost;
  // it is sealed into daily.json the first time a check lands on a new day.
  let dayRolled = false;
  if (history.today.d !== day) {
    if (history.today.n > 0) {
      daily.push(history.today);
      if (daily.length > config.retention.days) {
        daily.splice(0, daily.length - config.retention.days);
      }
    }
    history.today = emptyBucket(day);
    dayRolled = true;
  }

  // The day bucket and the response-time window accumulate the same numbers
  // over different spans, so fold the result into both in one pass.
  for (const bucket of [history.today, history.window]) {
    bucket.n++;
    bucket.sum += result.ms;
    if (result.ms > bucket.max) bucket.max = result.ms;
    if (result.s === "down") bucket.down++;
    else if (result.s === "degraded") bucket.deg++;
  }

  // --- debounced status ---------------------------------------------------
  history.consecutiveFailures = result.s === "down" ? history.consecutiveFailures + 1 : 0;

  const next: MonitorStatus = monitor.paused
    ? "paused"
    : result.s === "down"
      ? // Hold the previous status until the failure threshold is met, so a
        // single blip does not open an incident — or a GitHub issue.
        history.consecutiveFailures >= monitor.failureThreshold
        ? "down"
        : previous === "pending"
          ? "pending"
          : previous
      : result.s;

  history.lastUpdated = new Date(result.t).toISOString();
  history.responseTime = result.ms;
  history.code = result.c;
  history.error = result.e;

  let transition: Transition | null = null;
  if (next !== previous) {
    history.status = next;
    history.since = new Date(result.t).toISOString();
    transition = { monitorId: monitor.id, from: previous, to: next };
  }

  return { history, daily, dayRolled, transition };
}

/**
 * Opens, escalates or closes the incident implied by a transition, in both the
 * monitor's record and the shared incident log. The GitHub issue is handled
 * separately by the caller — this only moves the data.
 */
export function applyIncident(
  history: MonitorHistory,
  incidents: Incident[],
  transition: Transition,
  result: CheckResult,
): Incident | undefined {
  const { to, monitorId } = transition;

  if (to === "down" || to === "degraded") {
    const reason = result.e ?? `Responded in ${Math.round(result.ms)}ms`;

    if (history.incident) {
      // Escalating degraded → down keeps one incident rather than two.
      const open = incidents.find((i) => i.id === history.incident!.id);
      history.incident.severity = to;
      history.incident.reason = reason;
      if (open) {
        open.severity = to;
        open.reason = reason;
      }
      return open;
    }

    const incident: Incident = {
      id: `${monitorId}-${result.t}`,
      monitorId,
      startedAt: result.t,
      severity: to,
      reason,
    };
    incidents.unshift(incident);
    history.incident = {
      id: incident.id,
      startedAt: incident.startedAt,
      severity: to,
      reason,
    };
    return incident;
  }

  // Recovered (or paused): close whatever was open.
  if (!history.incident) return undefined;
  const open = incidents.find((i) => i.id === history.incident!.id);
  if (open) open.endedAt = result.t;
  return open;
}

// ---------------------------------------------------------------------------
// Aggregation for the published snapshot
// ---------------------------------------------------------------------------

function uptimeOver(buckets: DayBucket[], days: number): number | null {
  const window = buckets.slice(-days);
  let total = 0;
  let down = 0;
  for (const b of window) {
    total += b.n;
    down += b.down;
  }
  return total === 0 ? null : (total - down) / total;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** Health of the whole fleet: the worst status any active monitor is in. */
export function worstStatus(statuses: MonitorStatus[]): MonitorStatus {
  const rank: Record<MonitorStatus, number> = {
    down: 4,
    degraded: 3,
    pending: 2,
    up: 1,
    paused: 0,
  };
  return statuses.reduce<MonitorStatus>(
    (worst, s) => (rank[s] > rank[worst] ? s : worst),
    "up",
  );
}

export function buildMonitorSnapshot(
  m: ResolvedMonitor,
  history: MonitorHistory,
  daily: DayBucket[],
  samples: CheckResult[],
): MonitorSnapshot {
  // `today` is live and not yet in daily.json, so append it for the windows.
  const buckets = history.today.n > 0 ? [...daily, history.today] : daily;

  // Sparklines and the latency chart read `recent`. The 6-hourly samples are
  // the durable series; the newest check is appended so the card is never
  // showing a number up to six hours older than the status beside it.
  const last = history.responseTime;
  const lastAt = Date.parse(history.lastUpdated);
  const recent: CheckResult[] =
    last !== undefined && (samples.length === 0 || samples[samples.length - 1].t < lastAt)
      ? [
          ...samples,
          {
            t: lastAt,
            s: (history.status === "paused" || history.status === "pending"
              ? "up"
              : history.status) as Health,
            ms: last,
            ...(history.code !== undefined ? { c: history.code } : {}),
            ...(history.error !== undefined ? { e: history.error } : {}),
          },
        ]
      : samples;

  const latencies = recent.filter((c) => c.s !== "down").map((c) => c.ms);
  const sorted = [...latencies].sort((a, b) => a - b);

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
    state: {
      status: history.status,
      since: Date.parse(history.since),
      lastCheck: Number.isNaN(lastAt) ? undefined : lastAt,
      lastLatency: history.responseTime,
      lastCode: history.code,
      lastError: history.error,
      consecutiveFailures: history.consecutiveFailures,
    },
    recent,
    daily: buckets,
    uptime: {
      day: uptimeOver(buckets, 1),
      week: uptimeOver(buckets, 7),
      month: uptimeOver(buckets, 30),
      quarter: uptimeOver(buckets, 90),
    },
    latency: {
      avg: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      p95: latencies.length ? Math.round(percentile(sorted, 95)) : null,
      min: latencies.length ? Math.round(sorted[0]) : null,
      max: latencies.length ? Math.round(sorted[sorted.length - 1]) : null,
    },
  };
}

export function buildSnapshot(
  config: UpsiteConfig,
  monitors: MonitorSnapshot[],
  incidents: Incident[],
): StatusSnapshot {
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
    repository: {
      owner: config.repository.owner,
      name: config.repository.name,
      branch: config.repository.branch,
    },
    overall: worstStatus(
      monitors.filter((m) => m.state.status !== "paused").map((m) => m.state.status),
    ),
    generatedAt: Date.now(),
    monitors,
    incidents,
    counts,
  };
}
