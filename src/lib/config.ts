import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Upsite is configured entirely by `upsite.config.yaml`, the same way Upptime
 * is driven by `.upptimerc.yml`. There is no admin UI and no database — the
 * file is the source of truth, and editing it is how you add a monitor.
 */

const CONFIG_FILENAME = "upsite.config.yaml";

/** Substitutes `${VAR}` with `process.env.VAR` so secrets stay out of the file. */
function expandString(raw: string): string {
  return raw.replace(/\$\{([A-Z0-9_]+)\}/gi, (whole, name: string) => {
    const value = process.env[name];
    if (value === undefined) {
      console.warn(`[upsite] config references \${${name}} but it is unset`);
      return whole;
    }
    return value;
  });
}

/**
 * Walks the parsed document expanding every string value. Deliberately applied
 * after parsing rather than to the raw text — otherwise a `${VAR}` written
 * inside a YAML comment would be "expanded" and warn about nothing.
 */
function expandEnv(value: unknown): unknown {
  if (typeof value === "string") return expandString(value);
  if (Array.isArray(value)) return value.map(expandEnv);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, expandEnv(v)]),
    );
  }
  return value;
}

const httpMonitor = z.object({
  type: z.literal("http").optional().default("http"),
  url: z.string().url(),
  method: z
    .enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    .default("GET"),
  headers: z.record(z.string()).default({}),
  body: z.string().optional(),
  /** HTTP codes treated as healthy. Defaults to "any 2xx or 3xx". */
  expectStatus: z.array(z.number().int().min(100).max(599)).optional(),
  /** Response body must contain this substring, else the check fails. */
  expectText: z.string().optional(),
  /** Fail the check if the body *does* contain this substring. */
  rejectText: z.string().optional(),
  followRedirects: z.boolean().default(true),
});

const tcpMonitor = z.object({
  type: z.literal("tcp"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
});

const commonMonitor = z.object({
  /** Stable slug — used as the on-disk filename and the detail-page route. */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i, "id must be url-safe (letters, digits, - and _)"),
  name: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  intervalSeconds: z.number().int().min(5).optional(),
  timeoutMs: z.number().int().min(100).optional(),
  /** Above this latency a passing check is reported as `degraded`. */
  degradedMs: z.number().int().min(1).optional(),
  /** Consecutive failures required before the monitor is declared down. */
  failureThreshold: z.number().int().min(1).optional(),
  retries: z.number().int().min(0).max(5).optional(),
  paused: z.boolean().default(false),
  /**
   * Hides the monitor behind the password gate. It is still checked on
   * schedule — only its existence and results are withheld from unauthenticated
   * callers, across every API surface.
   */
  secure: z.boolean().default(false),
});

const monitorSchema = z.intersection(
  commonMonitor,
  z.discriminatedUnion("type", [
    httpMonitor.extend({ type: z.literal("http") }),
    tcpMonitor,
  ]),
);

/**
 * `type` defaults to `http`, but a discriminated union needs the tag present
 * before it can narrow — so fill it in before validation rather than after.
 */
const monitorInput = z.preprocess((value) => {
  if (value && typeof value === "object" && !("type" in value)) {
    return { ...(value as Record<string, unknown>), type: "http" };
  }
  return value;
}, monitorSchema);

const configSchema = z.object({
  site: z
    .object({
      name: z.string().default("Upsite"),
      tagline: z.string().optional(),
      url: z.string().url().optional(),
    })
    .default({ name: "Upsite" }),
  defaults: z
    .object({
      intervalSeconds: z.number().int().min(5).default(60),
      timeoutMs: z.number().int().min(100).default(10_000),
      degradedMs: z.number().int().min(1).default(1_500),
      failureThreshold: z.number().int().min(1).default(2),
      retries: z.number().int().min(0).max(5).default(1),
    })
    .default({}),
  retention: z
    .object({
      /** Raw checks kept per monitor, in memory and on disk. */
      recentChecks: z.number().int().min(60).default(2_880),
      /** Daily rollups kept per monitor. */
      days: z.number().int().min(1).default(90),
      /** Incidents kept in the log. */
      incidents: z.number().int().min(1).default(200),
    })
    .default({}),
  notifications: z
    .object({
      /** POSTed a JSON payload on every status transition. */
      webhooks: z.array(z.string().url()).default([]),
      /** Slack/Discord-compatible incoming webhook. */
      slackWebhook: z.string().url().optional(),
    })
    .default({}),
  monitors: z.array(monitorInput).min(1),
});

export type RawConfig = z.infer<typeof configSchema>;
export type RawMonitor = RawConfig["monitors"][number];

/** A monitor with every default already folded in — no optionals downstream. */
export type ResolvedMonitor = RawMonitor & {
  intervalSeconds: number;
  timeoutMs: number;
  degradedMs: number;
  failureThreshold: number;
  retries: number;
};

export interface UpsiteConfig extends Omit<RawConfig, "monitors"> {
  monitors: ResolvedMonitor[];
}

function resolve(config: RawConfig): UpsiteConfig {
  const d = config.defaults;
  const seen = new Set<string>();

  const monitors = config.monitors.map((m) => {
    if (seen.has(m.id)) {
      throw new Error(`[upsite] duplicate monitor id "${m.id}" in ${CONFIG_FILENAME}`);
    }
    seen.add(m.id);

    return {
      ...m,
      intervalSeconds: m.intervalSeconds ?? d.intervalSeconds,
      timeoutMs: m.timeoutMs ?? d.timeoutMs,
      degradedMs: m.degradedMs ?? d.degradedMs,
      failureThreshold: m.failureThreshold ?? d.failureThreshold,
      retries: m.retries ?? d.retries,
    } as ResolvedMonitor;
  });

  return { ...config, monitors };
}

export function configPath(): string {
  return process.env.UPSITE_CONFIG
    ? path.resolve(process.env.UPSITE_CONFIG)
    : path.join(process.cwd(), CONFIG_FILENAME);
}

/**
 * Reads and validates the config from disk. Throws with a readable message on
 * malformed YAML or a schema violation — a bad config should stop the process,
 * not silently monitor nothing.
 */
export function loadConfig(): UpsiteConfig {
  const file = configPath();

  if (!existsSync(file)) {
    throw new Error(
      `[upsite] no config found at ${file}. Create one, or point UPSITE_CONFIG at it.`,
    );
  }

  const parsed = expandEnv(parseYaml(readFileSync(file, "utf8")));
  const result = configSchema.safeParse(parsed);

  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  · ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`[upsite] invalid ${CONFIG_FILENAME}:\n${detail}`);
  }

  return resolve(result.data);
}

/**
 * Cached accessor. The engine re-reads on demand via `reloadConfig()`; every
 * other caller gets the memoised copy so a request never touches the disk.
 */
let cached: UpsiteConfig | null = null;

export function getConfig(): UpsiteConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

export function reloadConfig(): UpsiteConfig {
  cached = loadConfig();
  return cached;
}

/** Human-readable target string used in the UI. */
export function monitorTarget(m: ResolvedMonitor): string {
  return m.type === "tcp" ? `${m.host}:${m.port}` : m.url;
}
