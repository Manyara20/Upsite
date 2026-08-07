import { promises as fs } from "node:fs";
import { parseDocument, YAMLMap, YAMLSeq, type Document } from "yaml";
import { z } from "zod";
import { configPath } from "./config";

/**
 * Writes new monitors back into `upsite.config.yaml`.
 *
 * The config file is the source of truth, so "add a monitor" has to mean
 * "edit that file" — not "put a row somewhere else". It is edited as a YAML
 * *document* rather than parsed-and-restringified, which preserves the
 * comments and formatting a human put there.
 */

export const newMonitorSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-_]*$/i, "Use letters, digits, - and _ only"),
    name: z.string().trim().min(1).max(80),
    type: z.enum(["http", "tcp"]).default("http"),
    url: z.string().trim().url().optional(),
    host: z.string().trim().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    description: z.string().trim().max(200).optional(),
    tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
    intervalSeconds: z.number().int().min(5).max(86_400).optional(),
    degradedMs: z.number().int().min(1).max(120_000).optional(),
    expectStatus: z.array(z.number().int().min(100).max(599)).max(10).optional(),
    expectText: z.string().trim().max(200).optional(),
    secure: z.boolean().default(false),
    paused: z.boolean().default(false),
  })
  .refine((m) => (m.type === "http" ? Boolean(m.url) : Boolean(m.host && m.port)), {
    message: "http monitors need a url; tcp monitors need a host and port",
  });

export type NewMonitor = z.infer<typeof newMonitorSchema>;

/** Strips keys that are absent or empty so the written YAML stays minimal. */
function toYamlValue(monitor: NewMonitor): Record<string, unknown> {
  const out: Record<string, unknown> = { id: monitor.id, name: monitor.name };

  if (monitor.type === "tcp") {
    out.type = "tcp";
    out.host = monitor.host;
    out.port = monitor.port;
  } else {
    out.url = monitor.url;
  }

  if (monitor.description) out.description = monitor.description;
  if (monitor.tags.length) out.tags = monitor.tags;
  if (monitor.intervalSeconds) out.intervalSeconds = monitor.intervalSeconds;
  if (monitor.degradedMs) out.degradedMs = monitor.degradedMs;
  if (monitor.expectStatus?.length) out.expectStatus = monitor.expectStatus;
  if (monitor.expectText) out.expectText = monitor.expectText;
  if (monitor.secure) out.secure = true;
  if (monitor.paused) out.paused = true;

  return out;
}

/**
 * Serialisation options chosen to leave the rest of the file untouched:
 * `flowCollectionPadding: false` stops the writer from re-spacing existing
 * `[a, b]` lists into `[ a, b ]`, which would show up as noise in a diff.
 */
const STRINGIFY_OPTIONS = { lineWidth: 0, flowCollectionPadding: false } as const;

/** Builds the node for a monitor, keeping short lists inline like the hand-written entries. */
function buildNode(doc: Document, monitor: NewMonitor) {
  const node = doc.createNode(toYamlValue(monitor));

  if (node instanceof YAMLMap) {
    for (const key of ["tags", "expectStatus"]) {
      const seq = node.get(key, true);
      if (seq instanceof YAMLSeq) seq.flow = true;
    }
  }

  return node;
}

/**
 * Appends a monitor to the config file. Throws if the id is already taken —
 * the engine keys its on-disk history by id, so duplicates would silently
 * merge two different targets' history.
 */
export async function appendMonitor(monitor: NewMonitor): Promise<void> {
  const file = configPath();
  const doc = parseDocument(await fs.readFile(file, "utf8"));

  const monitors = doc.get("monitors");
  if (!(monitors instanceof YAMLSeq)) {
    throw new Error("Config has no `monitors:` list to append to");
  }

  const taken = monitors.items.some((item) => {
    const node = item as { get?: (key: string) => unknown };
    return typeof node.get === "function" && node.get("id") === monitor.id;
  });
  if (taken) {
    throw new Error(`A monitor with id "${monitor.id}" already exists`);
  }

  monitors.add(buildNode(doc, monitor));

  // Blank line between entries, matching how the file is written by hand.
  const node = monitors.items[monitors.items.length - 1] as { spaceBefore?: boolean };
  node.spaceBefore = true;

  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, doc.toString(STRINGIFY_OPTIONS), "utf8");
  await fs.rename(tmp, file);
}

/** Removes a monitor from the config. Returns false if the id was not found. */
export async function removeMonitor(id: string): Promise<boolean> {
  const file = configPath();
  const doc = parseDocument(await fs.readFile(file, "utf8"));

  const monitors = doc.get("monitors");
  if (!(monitors instanceof YAMLSeq)) return false;

  const index = monitors.items.findIndex((item) => {
    const node = item as { get?: (key: string) => unknown };
    return typeof node.get === "function" && node.get("id") === id;
  });
  if (index === -1) return false;

  // A config with no monitors fails validation, so refuse to empty it.
  if (monitors.items.length === 1) {
    throw new Error("Cannot remove the last monitor — the config requires at least one");
  }

  monitors.delete(index);

  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, doc.toString(STRINGIFY_OPTIONS), "utf8");
  await fs.rename(tmp, file);
  return true;
}
