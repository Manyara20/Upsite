import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Filesystem access for the Actions-side scripts.
 *
 * There is no database: the repository working tree *is* the store. These
 * helpers are deliberately plain — a workflow step checks the repo out, calls
 * one of the scripts, and commits whatever changed.
 */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const HISTORY_DIR = path.join(ROOT, "history");
export const API_DIR = path.join(ROOT, "api");
export const GRAPHS_DIR = path.join(ROOT, "graphs");

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    // A truncated file from an interrupted run must not wedge every future
    // run. Warn loudly and carry on from the fallback.
    console.warn(`[upsite] ${path.relative(ROOT, file)} is unreadable, resetting:`, err);
    return fallback;
  }
}

/**
 * Writes JSON with a trailing newline and stable two-space indentation. Both
 * matter: these files land in git diffs that humans read.
 */
export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readYamlFile<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return (parseYaml(readFileSync(file, "utf8")) as T) ?? fallback;
  } catch (err) {
    console.warn(`[upsite] ${path.relative(ROOT, file)} is unreadable, resetting:`, err);
    return fallback;
  }
}

export function writeYamlFile(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  // `undefined` fields would serialise as `null` keys and clutter the diff.
  const pruned = JSON.parse(JSON.stringify(value)) as unknown;
  writeFileSync(file, stringifyYaml(pruned, { lineWidth: 0 }));
}

export const historyFile = (id: string) => path.join(HISTORY_DIR, `${id}.yml`);
export const dailyFile = (id: string) => path.join(HISTORY_DIR, `${id}.daily.json`);
export const responseFile = (id: string) => path.join(HISTORY_DIR, `${id}.response-time.json`);
export const incidentsFile = () => path.join(HISTORY_DIR, "incidents.json");
