import type { UpsiteConfig } from "../../src/lib/config";

/**
 * Slack notifications. The payload is deliberately Block Kit *plus* a `text`
 * fallback, because the same incoming-webhook URL shape is used by Discord and
 * by Slack's own notification previews, and both fall back to `text`.
 */

const TIMEOUT_MS = 8_000;

export interface Notification {
  /** Single-line summary, used as the fallback and the push notification. */
  headline: string;
  /** Markdown body shown in the message. */
  detail: string;
  /** "Open incident" style link, omitted when there is nothing to link to. */
  link?: { text: string; url: string };
  colour: "good" | "warning" | "danger";
}

const COLOURS: Record<Notification["colour"], string> = {
  good: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
};

async function post(url: string, payload: unknown): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[upsite] webhook ${new URL(url).host} replied ${res.status}`);
    }
  } catch (err) {
    // A failed notification must never fail the check that triggered it.
    console.warn(`[upsite] webhook ${new URL(url).host} failed:`, err);
  }
}

export async function notify(config: UpsiteConfig, n: Notification): Promise<void> {
  const { slackWebhook, webhooks } = config.notifications;
  const jobs: Promise<void>[] = [];

  if (slackWebhook) {
    jobs.push(
      post(slackWebhook, {
        text: n.headline,
        attachments: [
          {
            color: COLOURS[n.colour],
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: `*${n.headline}*\n${n.detail}` },
              },
              ...(n.link
                ? [
                    {
                      type: "actions",
                      elements: [
                        {
                          type: "button",
                          text: { type: "plain_text", text: n.link.text },
                          url: n.link.url,
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
        ],
      }),
    );
  }

  for (const url of webhooks) {
    jobs.push(post(url, { ...n, site: config.site.name, at: Date.now() }));
  }

  await Promise.all(jobs);
}
