import net from "node:net";
import type { CheckResult, Health } from "./types";
import type { ResolvedMonitor } from "./config";

/**
 * The probes. Each returns a `CheckResult` and never throws — a check that
 * blew up *is* a result, and the scheduler depends on always getting one.
 */

interface Probe {
  health: Health;
  ms: number;
  code?: number;
  error?: string;
}

/** Default acceptance when no `expectStatus` is configured: any 2xx or 3xx. */
function statusAccepted(code: number, expect?: number[]): boolean {
  if (expect && expect.length > 0) return expect.includes(code);
  return code >= 200 && code < 400;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    // fetch wraps DNS/TLS/socket failures; the cause carries the useful part.
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      const code = (cause as Error & { code?: string }).code;
      return code ? `${code}: ${cause.message}` : cause.message;
    }
    if (err.name === "TimeoutError" || err.name === "AbortError") return "Timed out";
    return err.message;
  }
  return String(err);
}

async function probeHttp(m: Extract<ResolvedMonitor, { type: "http" }>): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), m.timeoutMs);
  const started = performance.now();

  try {
    const res = await fetch(m.url, {
      method: m.method,
      headers: {
        // Identify ourselves so operators can spot the traffic in their logs.
        "user-agent": "Upsite/1.0 (+uptime-monitor)",
        ...m.headers,
      },
      body: m.body,
      redirect: m.followRedirects ? "follow" : "manual",
      cache: "no-store",
      signal: controller.signal,
    });

    // Time to headers is the latency users feel; body download is separate.
    const ms = performance.now() - started;
    const needsBody = Boolean(m.expectText || m.rejectText);
    const text = needsBody ? await res.text() : null;

    // Always drain the body, or the socket stays open until GC.
    if (!needsBody) await res.arrayBuffer().catch(() => undefined);

    if (!statusAccepted(res.status, m.expectStatus)) {
      return {
        health: "down",
        ms,
        code: res.status,
        error: `Unexpected status ${res.status} ${res.statusText}`.trim(),
      };
    }

    if (m.expectText && !text?.includes(m.expectText)) {
      return {
        health: "down",
        ms,
        code: res.status,
        error: `Response body is missing "${m.expectText}"`,
      };
    }

    if (m.rejectText && text?.includes(m.rejectText)) {
      return {
        health: "down",
        ms,
        code: res.status,
        error: `Response body contains "${m.rejectText}"`,
      };
    }

    return {
      health: ms > m.degradedMs ? "degraded" : "up",
      ms,
      code: res.status,
    };
  } catch (err) {
    return {
      health: "down",
      ms: performance.now() - started,
      error: controller.signal.aborted ? `Timed out after ${m.timeoutMs}ms` : describeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function probeTcp(m: Extract<ResolvedMonitor, { type: "tcp" }>): Promise<Probe> {
  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;

    const finish = (probe: Probe) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(probe);
    };

    const socket = net.createConnection({ host: m.host, port: m.port });
    socket.setTimeout(m.timeoutMs);

    socket.once("connect", () => {
      const ms = performance.now() - started;
      finish({ health: ms > m.degradedMs ? "degraded" : "up", ms });
    });

    socket.once("timeout", () => {
      finish({
        health: "down",
        ms: performance.now() - started,
        error: `Timed out after ${m.timeoutMs}ms`,
      });
    });

    socket.once("error", (err) => {
      finish({
        health: "down",
        ms: performance.now() - started,
        error: describeError(err),
      });
    });
  });
}

async function probeOnce(m: ResolvedMonitor): Promise<Probe> {
  return m.type === "tcp" ? probeTcp(m) : probeHttp(m);
}

/**
 * Runs a monitor's probe, retrying on failure up to `retries` times with a
 * short linear backoff. Only a genuinely repeatable failure is reported down,
 * which keeps transient packet loss out of the incident log.
 */
export async function runCheck(m: ResolvedMonitor): Promise<CheckResult> {
  let probe = await probeOnce(m);

  for (let attempt = 0; probe.health === "down" && attempt < m.retries; attempt++) {
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    probe = await probeOnce(m);
  }

  const result: CheckResult = {
    t: Date.now(),
    s: probe.health,
    ms: Math.round(probe.ms),
  };
  if (probe.code !== undefined) result.c = probe.code;
  if (probe.error !== undefined) result.e = probe.error;

  return result;
}
