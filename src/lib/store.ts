import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CheckResult,
  DayBucket,
  Incident,
  MonitorSnapshot,
  MonitorState,
  MonitorStatus,
  StatusSnapshot,
} from "./types";
import { getConfig, monitorTarget, type ResolvedMonitor, type UpsiteConfig } from "./config";

/**
 * The datastore. There is no database — state lives in memory and is mirrored
 * to plain files under `.data/`:
 *
 *   .data/monitors/<id>.jsonl        append-only recent checks
 *   .data/monitors/<id>.daily.json   calendar-day rollups
 *   .data/state.json                 current status per monitor
 *   .data/incidents.json             incident log
 *
 * Reads never touch the disk after boot, so the dashboard is served entirely
 * from memory. Writes are append-mostly, with periodic compaction to keep the
 * JSONL files bounded by the configured retention.
 */

const DATA_DIR = process.env.UPSITE_DATA_DIR
  ? path.resolve(process.env.UPSITE_DATA_DIR)
  : path.join(process.cwd(), ".data");

const MONITOR_DIR = path.join(DATA_DIR, "monitors");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const INCIDENT_FILE = path.join(DATA_DIR, "incidents.json");

/** How long to batch state/rollup writes before flushing. */
const FLUSH_DEBOUNCE_MS = 2_000;

interface MonitorRuntime {
  state: MonitorState;
  /** oldest first */
  recent: CheckResult[];
  /** oldest first */
  daily: DayBucket[];
  /** lines appended since the last compaction of the JSONL file */
  appended: number;
}

export interface Transition {
  monitorId: string;
  from: MonitorStatus;
  to: MonitorStatus;
  incident?: Incident;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(MONITOR_DIR, { recursive: true });
}

/** Write via a temp file + rename so a crash can never leave a half file. */
async function writeAtomic(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, file);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Tolerates a truncated final line, which an unclean shutdown can leave behind. */
async function readJsonl<T>(file: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }

  const out: T[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // Partial write at EOF — drop it and keep everything before it.
    }
  }
  return out;
}

function newState(): MonitorState {
  return { status: "pending", since: Date.now(), consecutiveFailures: 0 };
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/** Uptime ratio (0–1) over the checks recorded since `sinceMs`. */
function uptimeFromChecks(checks: CheckResult[], sinceMs: number): number | null {
  let total = 0;
  let down = 0;
  for (const c of checks) {
    if (c.t < sinceMs) continue;
    total++;
    if (c.s === "down") down++;
  }
  return total === 0 ? null : (total - down) / total;
}

/** Uptime ratio (0–1) over the last `days` calendar days of rollups. */
function uptimeFromDaily(daily: DayBucket[], days: number): number | null {
  const window = daily.slice(-days);
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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class Store {
  private monitors = new Map<string, MonitorRuntime>();
  private incidents: Incident[] = [];
  private config: UpsiteConfig = getConfig();
  private flushTimer: NodeJS.Timeout | null = null;
  private ready = false;

  /** Loads everything from disk and reconciles it against the current config. */
  async init(config: UpsiteConfig): Promise<void> {
    if (this.ready) return;
    this.config = config;
    await ensureDirs();

    const savedStates = await readJson<Record<string, MonitorState>>(STATE_FILE, {});
    this.incidents = await readJson<Incident[]>(INCIDENT_FILE, []);

    await Promise.all(
      config.monitors.map(async (m) => {
        const [recent, daily] = await Promise.all([
          readJsonl<CheckResult>(this.jsonlPath(m.id)),
          readJson<DayBucket[]>(this.dailyPath(m.id), []),
        ]);

        const trimmed = recent.slice(-config.retention.recentChecks);
        const state = savedStates[m.id] ?? newState();

        this.monitors.set(m.id, {
          // A paused monitor reports paused regardless of what it was doing
          // when the process last stopped.
          state: m.paused ? { ...state, status: "paused" } : state,
          recent: trimmed,
          daily: daily.slice(-config.retention.days),
          appended: trimmed.length,
        });
      }),
    );

    // Drop persisted state for monitors that have been removed from the config.
    this.ready = true;
  }

  private jsonlPath(id: string): string {
    return path.join(MONITOR_DIR, `${id}.jsonl`);
  }

  private dailyPath(id: string): string {
    return path.join(MONITOR_DIR, `${id}.daily.json`);
  }

  private runtime(id: string): MonitorRuntime {
    let rt = this.monitors.get(id);
    if (!rt) {
      rt = { state: newState(), recent: [], daily: [], appended: 0 };
      this.monitors.set(id, rt);
    }
    return rt;
  }

  /**
   * Records one check result: updates the in-memory state, folds it into the
   * day's rollup, applies the failure threshold, and opens or closes an
   * incident if the debounced status changed. Returns the transition, if any.
   */
  async record(
    monitor: ResolvedMonitor,
    result: CheckResult,
  ): Promise<Transition | null> {
    const rt = this.runtime(monitor.id);
    const prevStatus = rt.state.status;

    // --- recent ring buffer ---
    rt.recent.push(result);
    const cap = this.config.retention.recentChecks;
    if (rt.recent.length > cap) rt.recent.splice(0, rt.recent.length - cap);

    // --- daily rollup ---
    const day = utcDay(result.t);
    let bucket = rt.daily[rt.daily.length - 1];
    if (!bucket || bucket.d !== day) {
      bucket = { d: day, n: 0, down: 0, deg: 0, sum: 0, max: 0 };
      rt.daily.push(bucket);
      if (rt.daily.length > this.config.retention.days) {
        rt.daily.splice(0, rt.daily.length - this.config.retention.days);
      }
    }
    bucket.n++;
    bucket.sum += result.ms;
    if (result.ms > bucket.max) bucket.max = result.ms;
    if (result.s === "down") bucket.down++;
    else if (result.s === "degraded") bucket.deg++;

    // --- debounced status ---
    if (result.s === "down") {
      rt.state.consecutiveFailures++;
    } else {
      rt.state.consecutiveFailures = 0;
    }

    const nextStatus: MonitorStatus = monitor.paused
      ? "paused"
      : result.s === "down"
        ? // Hold the previous status until the failure threshold is met, so a
          // single blip does not open an incident.
          rt.state.consecutiveFailures >= monitor.failureThreshold
          ? "down"
          : prevStatus === "pending"
            ? "pending"
            : prevStatus
        : result.s;

    rt.state.lastCheck = result.t;
    rt.state.lastLatency = result.ms;
    rt.state.lastCode = result.c;
    rt.state.lastError = result.e;

    let transition: Transition | null = null;
    if (nextStatus !== prevStatus) {
      rt.state.status = nextStatus;
      rt.state.since = result.t;
      transition = {
        monitorId: monitor.id,
        from: prevStatus,
        to: nextStatus,
        incident: this.applyIncident(monitor.id, nextStatus, result),
      };
    }

    // --- persistence ---
    await this.appendCheck(monitor.id, result, rt);
    this.scheduleFlush();

    return transition;
  }

  /** Opens, escalates, or closes the incident implied by a status change. */
  private applyIncident(
    monitorId: string,
    status: MonitorStatus,
    result: CheckResult,
  ): Incident | undefined {
    const open = this.incidents.find((i) => i.monitorId === monitorId && !i.endedAt);

    if (status === "down" || status === "degraded") {
      const reason = result.e ?? `Responded in ${Math.round(result.ms)}ms`;
      if (open) {
        // Escalating degraded → down keeps one incident rather than two.
        if (open.severity !== status) {
          open.severity = status;
          open.reason = reason;
        }
        return open;
      }
      const incident: Incident = {
        id: `${monitorId}-${result.t}`,
        monitorId,
        startedAt: result.t,
        severity: status,
        reason,
      };
      this.incidents.unshift(incident);
      const cap = this.config.retention.incidents;
      if (this.incidents.length > cap) this.incidents.length = cap;
      return incident;
    }

    if (open) {
      open.endedAt = result.t;
      return open;
    }
    return undefined;
  }

  private async appendCheck(
    id: string,
    result: CheckResult,
    rt: MonitorRuntime,
  ): Promise<void> {
    try {
      await fs.appendFile(this.jsonlPath(id), `${JSON.stringify(result)}\n`, "utf8");
      rt.appended++;

      // Rewrite from memory once the file has grown to twice the retention
      // window. Amortised, this is far cheaper than trimming on every append.
      if (rt.appended > this.config.retention.recentChecks * 2) {
        const body = rt.recent.map((c) => JSON.stringify(c)).join("\n");
        await writeAtomic(this.jsonlPath(id), body ? `${body}\n` : "");
        rt.appended = rt.recent.length;
      }
    } catch (err) {
      console.error(`[upsite] failed to persist check for ${id}:`, err);
    }
  }

  /** Batches state/rollup/incident writes — they change on every single check. */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
    this.flushTimer.unref?.();
  }

  async flush(): Promise<void> {
    try {
      const states: Record<string, MonitorState> = {};
      const writes: Promise<void>[] = [];

      for (const [id, rt] of this.monitors) {
        states[id] = rt.state;
        writes.push(writeAtomic(this.dailyPath(id), JSON.stringify(rt.daily)));
      }

      writes.push(writeAtomic(STATE_FILE, JSON.stringify(states, null, 2)));
      writes.push(writeAtomic(INCIDENT_FILE, JSON.stringify(this.incidents, null, 2)));

      await Promise.all(writes);
    } catch (err) {
      console.error("[upsite] flush failed:", err);
    }
  }

  getState(id: string): MonitorState {
    return this.runtime(id).state;
  }

  setPaused(id: string, paused: boolean): void {
    const rt = this.runtime(id);
    if (paused) {
      rt.state.status = "paused";
    } else if (rt.state.status === "paused") {
      rt.state.status = "pending";
    }
    rt.state.since = Date.now();
    this.scheduleFlush();
  }

  getIncidents(): Incident[] {
    return this.incidents;
  }

  /** Builds the full view model for one monitor. */
  snapshotOf(monitor: ResolvedMonitor): MonitorSnapshot {
    const rt = this.runtime(monitor.id);
    const now = Date.now();
    const DAY = 86_400_000;

    const latencies = rt.recent
      .filter((c) => c.s !== "down")
      .map((c) => c.ms)
      .sort((a, b) => a - b);

    const sum = latencies.reduce((acc, v) => acc + v, 0);

    return {
      id: monitor.id,
      name: monitor.name,
      kind: monitor.type,
      target: monitorTarget(monitor),
      url: monitor.type === "http" ? monitor.url : undefined,
      tags: monitor.tags,
      description: monitor.description,
      secure: monitor.secure,
      intervalSeconds: monitor.intervalSeconds,
      state: rt.state,
      recent: rt.recent,
      daily: rt.daily,
      uptime: {
        day: uptimeFromChecks(rt.recent, now - DAY),
        week: uptimeFromDaily(rt.daily, 7),
        month: uptimeFromDaily(rt.daily, 30),
        quarter: uptimeFromDaily(rt.daily, 90),
      },
      latency: {
        avg: latencies.length ? sum / latencies.length : null,
        p95: latencies.length ? percentile(latencies, 95) : null,
        min: latencies.length ? latencies[0] : null,
        max: latencies.length ? latencies[latencies.length - 1] : null,
      },
    };
  }

  /**
   * Builds the whole-platform view model the dashboard renders from.
   *
   * Secure monitors are omitted entirely unless `includeSecure` is set — not
   * merely masked. They are excluded from the counts, the overall status and
   * the incident log too, so a locked caller cannot infer that a hidden
   * monitor is down from a banner that disagrees with the cards.
   */
  snapshot({ includeSecure = false }: { includeSecure?: boolean } = {}): StatusSnapshot {
    const config = this.config;
    const visible = config.monitors.filter((m) => includeSecure || !m.secure);
    const monitors = visible.map((m) => this.snapshotOf(m));
    const visibleIds = new Set(visible.map((m) => m.id));

    const counts: Record<MonitorStatus, number> = {
      up: 0,
      degraded: 0,
      down: 0,
      paused: 0,
      pending: 0,
    };
    for (const m of monitors) counts[m.state.status]++;

    // Overall reports the worst live status; paused monitors never drag it down.
    const overall: MonitorStatus =
      counts.down > 0
        ? "down"
        : counts.degraded > 0
          ? "degraded"
          : counts.up > 0
            ? "up"
            : counts.pending > 0
              ? "pending"
              : "paused";

    return {
      site: { name: config.site.name, tagline: config.site.tagline },
      overall,
      generatedAt: Date.now(),
      monitors,
      incidents: this.incidents.filter((i) => visibleIds.has(i.monitorId)).slice(0, 50),
      counts,
    };
  }

  setConfig(config: UpsiteConfig): void {
    this.config = config;
  }
}

/**
 * A module-level instance is not enough — Next's dev server re-evaluates
 * modules on reload, which would otherwise produce a second store with a
 * second view of the same files.
 */
const globalForStore = globalThis as typeof globalThis & { __upsiteStore?: Store };

export const store: Store = globalForStore.__upsiteStore ?? new Store();
globalForStore.__upsiteStore = store;

export type { Store };
export { DATA_DIR };
