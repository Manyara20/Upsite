import type { Sealed } from "./crypto";
import type { MonitorReport, StatusSnapshot } from "./types";

/**
 * The browser's half of the system.
 *
 * The status site is a static export with no backend of its own: it reads the
 * very files the uptime workflow committed, straight out of the repository,
 * through the GitHub API.
 */

export interface Source {
  owner: string;
  name: string;
  branch: string;
}

/** Unauthenticated api.github.com allows 60 requests an hour per IP. */
const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

export class SourceError extends Error {
  constructor(
    message: string,
    /** HTTP status from the last attempt, so callers can tell 404 apart. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

async function get(source: Source, file: string, signal?: AbortSignal): Promise<unknown> {
  const { owner, name, branch } = source;

  // The Contents API is the canonical route and is never CDN-cached, so a
  // check committed 30 seconds ago is visible immediately.
  try {
    const res = await fetch(
      `${API}/repos/${owner}/${name}/contents/${file}?ref=${encodeURIComponent(branch)}`,
      {
        headers: { accept: "application/vnd.github.raw+json" },
        cache: "no-store",
        signal,
      },
    );
    if (res.ok) return await res.json();
    if (res.status !== 403 && res.status !== 429) {
      throw new SourceError(`GitHub API returned ${res.status} for ${file}`, res.status);
    }
    // 403/429 is the anonymous rate limit. Fall through rather than fail: a
    // slightly stale page beats an empty one.
  } catch (err) {
    if (err instanceof SourceError) throw err;
    if (signal?.aborted) throw err;
  }

  // raw.githubusercontent.com is not rate limited, at the cost of a CDN cache
  // measured in minutes. The query string is what gets past that cache.
  const res = await fetch(
    `${RAW}/${owner}/${name}/${branch}/${file}?t=${Math.floor(Date.now() / 30_000)}`,
    { cache: "no-store", signal },
  );
  if (!res.ok) throw new SourceError(`Could not read ${file} (${res.status})`, res.status);
  return await res.json();
}

export function fetchSummary(source: Source, signal?: AbortSignal): Promise<StatusSnapshot> {
  return get(source, "api/summary.json", signal) as Promise<StatusSnapshot>;
}

export function fetchMonitor(
  source: Source,
  id: string,
  signal?: AbortSignal,
): Promise<MonitorReport> {
  return get(source, `api/${id}.json`, signal) as Promise<MonitorReport>;
}

/**
 * The sealed protected-monitor payload. Read through exactly the same path as
 * the public data — it is just another committed file; the difference is that
 * this one is ciphertext until the reader supplies the key.
 */
export function fetchSealed(source: Source, signal?: AbortSignal): Promise<Sealed> {
  return get(source, "api/secure.json", signal) as Promise<Sealed>;
}

/** Link to the issue holding an incident's reports, or to the issue list. */
export function issuesUrl(source: Source, labels: string[] = []): string {
  const query = ["is:issue", ...labels.map((l) => `label:${l}`)].join(" ");
  return `https://github.com/${source.owner}/${source.name}/issues?q=${encodeURIComponent(query)}`;
}

export function repoUrl(source: Source): string {
  return `https://github.com/${source.owner}/${source.name}`;
}

/** shields.io renders the endpoint files the workflow commits under `api/`. */
export function badgeUrl(source: Source, id: string, kind: "shields" | "uptime" | "response-time"): string {
  const endpoint = `${RAW}/${source.owner}/${source.name}/${source.branch}/api/${id}/${kind}.json`;
  return `https://img.shields.io/endpoint?url=${encodeURIComponent(endpoint)}&style=flat-square`;
}
