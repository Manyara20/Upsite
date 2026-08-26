/**
 * Shared vocabulary for the whole platform. Everything the UI renders is
 * derived from these shapes, so they are deliberately compact — they get
 * serialised to disk on every check.
 */

export type Health = "up" | "degraded" | "down";

/** `pending` means the monitor exists in config but has not been checked yet. */
export type MonitorStatus = Health | "paused" | "pending";

export type MonitorKind = "http" | "tcp";

/**
 * A single check outcome. Field names are one or two characters because these
 * are appended as JSONL — thousands of them per monitor per day.
 */
export interface CheckResult {
  /** epoch millis */
  t: number;
  /** resolved health for this check */
  s: Health;
  /** round-trip latency in millis */
  ms: number;
  /** HTTP status code, absent for TCP checks */
  c?: number;
  /** failure reason, present only when `s === "down"` */
  e?: string;
}

/** One calendar day of rolled-up history. Keeps long windows cheap. */
export interface DayBucket {
  /** YYYY-MM-DD in UTC */
  d: string;
  /** total checks recorded */
  n: number;
  /** checks that came back `down` */
  down: number;
  /** checks that came back `degraded` */
  deg: number;
  /** sum of latencies, for computing the mean without storing every sample */
  sum: number;
  /** slowest observed latency */
  max: number;
}

export interface Incident {
  id: string;
  monitorId: string;
  /** epoch millis */
  startedAt: number;
  /** epoch millis, absent while the incident is ongoing */
  endedAt?: number;
  /** the degraded/down state that opened this incident */
  severity: Exclude<Health, "up">;
  /** the error or condition that tripped it */
  reason: string;
  /** GitHub issue tracking this incident — the incident report lives there. */
  issue?: number;
  issueUrl?: string;
}

/** Current state for one monitor, mirrored into `history/<id>.yml`. */
export interface MonitorState {
  status: MonitorStatus;
  /** epoch millis the monitor entered its current status */
  since: number;
  /** epoch millis of the most recent check */
  lastCheck?: number;
  lastLatency?: number;
  lastCode?: number;
  lastError?: string;
  /** consecutive failing checks, used to satisfy the failure threshold */
  consecutiveFailures: number;
}

/** Everything the dashboard needs about one monitor, in one object. */
export interface MonitorSnapshot {
  id: string;
  name: string;
  kind: MonitorKind;
  /** display target — URL for http, host:port for tcp */
  target: string;
  url?: string;
  tags: string[];
  description?: string;
  /** Only ever sent to a caller that has unlocked the secure tab. */
  secure: boolean;
  intervalSeconds: number;
  state: MonitorState;
  /** rolling window of recent checks, oldest first */
  recent: CheckResult[];
  /** daily rollups, oldest first */
  daily: DayBucket[];
  uptime: {
    day: number | null;
    week: number | null;
    month: number | null;
    quarter: number | null;
  };
  latency: {
    avg: number | null;
    p95: number | null;
    min: number | null;
    max: number | null;
  };
}

export interface StatusSnapshot {
  site: { name: string; tagline?: string; url?: string };
  /** Lets the site link back to the repository the data came from. */
  repository: { owner: string; name: string; branch: string };
  /** worst status across all non-paused monitors */
  overall: MonitorStatus;
  generatedAt: number;
  monitors: MonitorSnapshot[];
  incidents: Incident[];
  counts: Record<MonitorStatus, number>;
}

/**
 * The per-monitor record committed to `history/<id>.yml` on every check. It is
 * the only mutable state in the system: everything under `api/` is derived
 * from these files and can be regenerated from scratch.
 */
export interface MonitorHistory {
  id: string;
  name: string;
  /** URL or host:port — whatever was probed. */
  target: string;
  status: MonitorStatus;
  /** ISO 8601, so a human reading the YAML in a diff can make sense of it. */
  since: string;
  lastUpdated: string;
  responseTime?: number;
  code?: number;
  error?: string;
  consecutiveFailures: number;
  /** Consecutive slow-but-passing checks, debounced the same way. */
  consecutiveDegraded: number;
  /** Today's accumulating rollup, sealed into `<id>.daily.json` at midnight. */
  today: DayBucket;
  /**
   * Accumulates between response-time recordings and is drained by the
   * 6-hourly workflow, so each committed sample is a true mean over ~72 checks
   * rather than whichever single check happened to land on the hour. `d` is
   * the ISO timestamp the window opened.
   */
  window: DayBucket;
  /** Present only while an outage is open. */
  incident?: {
    id: string;
    startedAt: number;
    severity: Exclude<Health, "up">;
    reason: string;
    issue?: number;
    issueUrl?: string;
    /** epoch millis of the last follow-up comment, for the throttle. */
    lastCommentAt?: number;
    /** the reason at the time of that comment, so a change forces a new one */
    lastCommentReason?: string;
  };
}

/** One 6-hourly response-time sample, appended to `<id>.response-time.json`. */
export type ResponseSample = CheckResult;

/**
 * What `api/<id>.json` holds: one monitor's full series plus its own incidents.
 * Bundling the two means the detail page reads a single file and can never show
 * a chart and an incident list that disagree about what happened.
 */
export interface MonitorReport extends MonitorSnapshot {
  incidents: Incident[];
}
