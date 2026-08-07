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
}

/** Live state for one monitor, held in memory and mirrored to disk. */
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
  site: { name: string; tagline?: string };
  /** worst status across all non-paused monitors */
  overall: MonitorStatus;
  generatedAt: number;
  monitors: MonitorSnapshot[];
  incidents: Incident[];
  counts: Record<MonitorStatus, number>;
}

/** Pushed over SSE whenever a check completes or a monitor changes status. */
export type StreamEvent =
  | { type: "check"; monitorId: string; result: CheckResult; state: MonitorState }
  | { type: "transition"; monitorId: string; from: MonitorStatus; to: MonitorStatus; incident?: Incident }
  | { type: "hello"; snapshot: StatusSnapshot };
