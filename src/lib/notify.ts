import type { UpsiteConfig } from "./config";
import type { Transition } from "./store";
import type { MonitorSnapshot } from "./types";

/**
 * Outbound alerting. Fire-and-forget by design — a webhook that is slow or
 * down must never delay or fail the check that triggered it.
 */

const NOTIFY_TIMEOUT_MS = 8_000;

function verb(t: Transition): string {
  switch (t.to) {
    case "down":
      return "went DOWN";
    case "degraded":
      return "is DEGRADED";
    case "up":
      return t.from === "pending" ? "is UP" : "recovered";
    case "paused":
      return "was paused";
    default:
      return `changed to ${t.to}`;
  }
}

function humanDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

async function post(url: string, payload: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[upsite] notification to ${new URL(url).host} failed:`, err);
  }
}

/**
 * Announces a status transition to every configured sink. Returns immediately;
 * delivery happens on the floating promises.
 */
export function notify(
  config: UpsiteConfig,
  transition: Transition,
  monitor: MonitorSnapshot,
): void {
  const { webhooks, slackWebhook } = config.notifications;
  if (webhooks.length === 0 && !slackWebhook) return;

  const emoji =
    transition.to === "up" ? "✅" : transition.to === "degraded" ? "⚠️" : "🔴";

  const headline = `${emoji} ${monitor.name} ${verb(transition)}`;
  const detail =
    transition.to === "up" && transition.incident?.endedAt
      ? `Resolved after ${humanDuration(
          transition.incident.endedAt - transition.incident.startedAt,
        )}`
      : (monitor.state.lastError ?? `${Math.round(monitor.state.lastLatency ?? 0)}ms`);

  for (const url of webhooks) {
    void post(url, {
      site: config.site.name,
      monitor: { id: monitor.id, name: monitor.name, target: monitor.target },
      from: transition.from,
      to: transition.to,
      incident: transition.incident,
      latencyMs: monitor.state.lastLatency,
      statusCode: monitor.state.lastCode,
      error: monitor.state.lastError,
      at: Date.now(),
    });
  }

  if (slackWebhook) {
    void post(slackWebhook, {
      // `text` is what Slack and Discord both fall back to, so send it always.
      text: `${headline}\n${monitor.target}\n${detail}`,
    });
  }
}
