import { isUnlockedRequest } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { ensureEngine } from "@/lib/engine";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shields-style SVG badges, rendered locally so a README never has to call out
 * to a third-party badge service.
 *
 *   /api/badge/<id>                → status
 *   /api/badge/<id>?type=uptime    → 30-day uptime
 *   /api/badge/<id>?type=response  → average response time
 */

const COLORS = {
  up: "#34d399",
  degraded: "#fbbf24",
  down: "#fb7185",
  paused: "#64748b",
  pending: "#64748b",
  slate: "#1a2234",
} as const;

/** Approximates Verdana 11px advance width — close enough for badge padding. */
function textWidth(text: string): number {
  return text.length * 6.6 + 12;
}

function badge(label: string, value: string, color: string): string {
  const lw = Math.round(textWidth(label));
  const vw = Math.round(textWidth(value));
  const total = lw + vw;

  // Text is drawn twice: a dark shadow copy, then the white face over it.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".7"/>
    <stop offset=".1" stop-color="#aaa" stop-opacity=".1"/>
    <stop offset=".9" stop-color="#000" stop-opacity=".3"/>
    <stop offset="1" stop-color="#000" stop-opacity=".5"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="${COLORS.slate}"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">
    <text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${lw / 2}" y="14">${label}</text>
    <text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${lw + vw / 2}" y="14">${value}</text>
  </g>
</svg>`;
}

function svg(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // Short cache: badges are embedded in READMEs and hit constantly.
      "cache-control": "public, max-age=60, s-maxage=60",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureEngine();

  const { id } = await params;
  const monitor = getConfig().monitors.find((m) => m.id === id);

  // Badges are meant to be embedded publicly, so a secure monitor reports
  // nothing at all rather than leaking its status into a README.
  if (!monitor || (monitor.secure && !isUnlockedRequest(request))) {
    return svg(badge("upsite", "not found", COLORS.down));
  }

  const snapshot = store.snapshotOf(monitor);
  const type = new URL(request.url).searchParams.get("type") ?? "status";
  const color = COLORS[snapshot.state.status];

  if (type === "uptime") {
    const value = snapshot.uptime.month ?? snapshot.uptime.day;
    return svg(
      badge("uptime", value === null ? "n/a" : `${(value * 100).toFixed(2)}%`, color),
    );
  }

  if (type === "response") {
    const avg = snapshot.latency.avg;
    return svg(badge("response", avg === null ? "n/a" : `${Math.round(avg)} ms`, color));
  }

  return svg(badge(monitor.name.toLowerCase(), snapshot.state.status, color));
}
