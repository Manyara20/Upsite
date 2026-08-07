import { getConfig, reloadConfig, type ResolvedMonitor, type UpsiteConfig } from "./config";
import { runCheck } from "./checker";
import { store } from "./store";
import { bus } from "./events";
import { notify } from "./notify";

/**
 * The scheduler. One self-rescheduling timer per monitor, rather than a single
 * global tick, so each monitor keeps its own interval and a slow check can
 * never delay an unrelated fast one.
 */

/**
 * Spread the first check of each monitor across a window so twenty monitors
 * don't all fire in the same millisecond on boot.
 */
const BOOT_SPREAD_MS = 4_000;

interface Scheduled {
  timer: NodeJS.Timeout;
  /** Guards against overlap when a check outlives its own interval. */
  running: boolean;
}

class Engine {
  private timers = new Map<string, Scheduled>();
  private config: UpsiteConfig | null = null;
  private started = false;

  get running(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const config = getConfig();
    this.config = config;
    await store.init(config);
    store.setConfig(config);

    const active = config.monitors.filter((m) => !m.paused);
    console.log(
      `[upsite] engine online — ${active.length} active monitor${active.length === 1 ? "" : "s"}` +
        (config.monitors.length !== active.length
          ? ` (${config.monitors.length - active.length} paused)`
          : ""),
    );

    config.monitors.forEach((m, i) => {
      if (m.paused) {
        store.setPaused(m.id, true);
        return;
      }
      const delay = Math.round((i / Math.max(1, config.monitors.length)) * BOOT_SPREAD_MS);
      this.schedule(m, delay);
    });

    this.installShutdownHooks();
  }

  private schedule(monitor: ResolvedMonitor, delayMs: number): void {
    const existing = this.timers.get(monitor.id);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      void this.tick(monitor);
    }, delayMs);

    // Never hold the process open just to run a check.
    timer.unref?.();
    this.timers.set(monitor.id, { timer, running: existing?.running ?? false });
  }

  private async tick(monitor: ResolvedMonitor): Promise<void> {
    const entry = this.timers.get(monitor.id);
    if (entry?.running) {
      // Previous check is still in flight — skip this beat instead of piling up.
      this.schedule(monitor, monitor.intervalSeconds * 1000);
      return;
    }
    if (entry) entry.running = true;

    try {
      await this.checkNow(monitor);
    } catch (err) {
      console.error(`[upsite] check for ${monitor.id} threw:`, err);
    } finally {
      const current = this.timers.get(monitor.id);
      if (current) current.running = false;
      // Only reschedule if we were not stopped mid-check.
      if (this.started && current) {
        this.schedule(monitor, monitor.intervalSeconds * 1000);
      }
    }
  }

  /** Runs one check immediately, records it, and broadcasts the outcome. */
  async checkNow(monitor: ResolvedMonitor): Promise<void> {
    const result = await runCheck(monitor);
    const transition = await store.record(monitor, result);

    bus.publish({
      type: "check",
      monitorId: monitor.id,
      result,
      state: store.getState(monitor.id),
    });

    if (transition) {
      const snapshot = store.snapshotOf(monitor);
      console.log(
        `[upsite] ${monitor.id}: ${transition.from} → ${transition.to}` +
          (result.e ? ` (${result.e})` : ""),
      );

      bus.publish({
        type: "transition",
        monitorId: monitor.id,
        from: transition.from,
        to: transition.to,
        incident: transition.incident,
      });

      if (this.config) notify(this.config, transition, snapshot);
    }
  }

  /**
   * Triggers an out-of-band check for one monitor, or all of them. `includeSecure`
   * scopes a fan-out check to what the caller is allowed to see.
   */
  async triggerCheck(
    monitorId?: string,
    { includeSecure = true }: { includeSecure?: boolean } = {},
  ): Promise<number> {
    const config = this.config ?? getConfig();
    const targets = config.monitors.filter(
      (m) =>
        !m.paused &&
        (!monitorId || m.id === monitorId) &&
        (includeSecure || !m.secure),
    );
    await Promise.all(targets.map((m) => this.checkNow(m)));
    return targets.length;
  }

  /** Re-reads the config file and rebuilds every timer to match. */
  async reload(): Promise<UpsiteConfig> {
    const config = reloadConfig();
    this.config = config;
    store.setConfig(config);

    for (const { timer } of this.timers.values()) clearTimeout(timer);
    this.timers.clear();

    config.monitors.forEach((m, i) => {
      if (m.paused) {
        store.setPaused(m.id, true);
        return;
      }
      store.setPaused(m.id, false);
      this.schedule(m, Math.round((i / Math.max(1, config.monitors.length)) * 1_000));
    });

    console.log(`[upsite] config reloaded — ${config.monitors.length} monitors`);
    return config;
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const { timer } of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await store.flush();
  }

  private installShutdownHooks(): void {
    const flushAndExit = (signal: string) => () => {
      console.log(`[upsite] ${signal} — flushing state`);
      void this.stop().finally(() => process.exit(0));
    };

    // `once` matters: a second SIGINT should kill immediately, not re-flush.
    process.once("SIGINT", flushAndExit("SIGINT"));
    process.once("SIGTERM", flushAndExit("SIGTERM"));
    process.once("beforeExit", () => void store.flush());
  }
}

const globalForEngine = globalThis as typeof globalThis & { __upsiteEngine?: Engine };

export const engine: Engine = globalForEngine.__upsiteEngine ?? new Engine();
globalForEngine.__upsiteEngine = engine;

/**
 * Route handlers call this instead of `engine.start()` directly. In production
 * `instrumentation.ts` has already booted the engine, but in dev a route can be
 * hit before instrumentation settles — this makes that harmless.
 */
export async function ensureEngine(): Promise<void> {
  if (!engine.running) await engine.start();
}
