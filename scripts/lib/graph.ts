import type { CheckResult } from "../../src/lib/types";

/**
 * Response-time graphs, drawn as SVG by hand.
 *
 * A charting library would mean shipping a headless browser or a canvas binding
 * into a workflow that runs 365 times a year, to draw one line. SVG text is
 * also the only output that diffs meaningfully in git and stays crisp in a
 * README at any zoom.
 */

const W = 720;
const H = 220;
const PAD = { top: 28, right: 16, bottom: 26, left: 48 };

const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

/** Rounds the axis top up to something a person would have chosen. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

function shortDate(t: number): string {
  return new Date(t).toISOString().slice(5, 10).replace("-", "/");
}

/**
 * The palette and the media query live inside the file so a single graph works
 * on the status site, in the README and in a GitHub issue, in either theme.
 */
const STYLE = `
  :root { color-scheme: light dark; }
  .bg { fill: #ffffff; }
  .grid { stroke: #e5e7eb; stroke-width: 1; }
  .axis { fill: #6b7280; font-size: 10px; }
  .title { fill: #111827; font-size: 13px; font-weight: 600; }
  .sub { fill: #6b7280; font-size: 10px; }
  .line { stroke: #6366f1; stroke-width: 2; fill: none; stroke-linejoin: round; stroke-linecap: round; }
  .area { fill: url(#fade); }
  .dot-degraded { fill: #f59e0b; }
  .dot-down { fill: #ef4444; }
  .empty { fill: #9ca3af; font-size: 12px; }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #0b0f19; }
    .grid { stroke: #1f2937; }
    .axis, .sub { fill: #9ca3af; }
    .title { fill: #f3f4f6; }
    .line { stroke: #818cf8; }
  }
`;

export interface GraphInput {
  name: string;
  samples: CheckResult[];
  /** Latency above which a passing check is called degraded, drawn as a rule. */
  degradedMs?: number;
}

export function responseTimeGraph({ name, samples, degradedMs }: GraphInput): string {
  const header = `<text class="title" x="${PAD.left}" y="18">${esc(name)}</text>`;

  if (samples.length === 0) {
    return wrap(
      `${header}<text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">No response times recorded yet</text>`,
    );
  }

  const values = samples.map((s) => s.ms);
  const top = niceCeiling(Math.max(...values, degradedMs ?? 0) * 1.1);
  const first = samples[0].t;
  const last = samples[samples.length - 1].t;
  const span = Math.max(1, last - first);

  // A single sample has no span to interpolate across, so pin it mid-plot
  // rather than dividing by a span of one millisecond.
  const x = (t: number) =>
    samples.length === 1 ? PAD.left + PLOT_W / 2 : PAD.left + ((t - first) / span) * PLOT_W;
  const y = (ms: number) => PAD.top + PLOT_H - (Math.min(ms, top) / top) * PLOT_H;

  const points = samples.map((s) => `${x(s.t).toFixed(1)},${y(s.ms).toFixed(1)}`);

  const gridLines: string[] = [];
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const ms = (top / ticks) * i;
    const gy = y(ms).toFixed(1);
    gridLines.push(
      `<line class="grid" x1="${PAD.left}" y1="${gy}" x2="${W - PAD.right}" y2="${gy}" />`,
      `<text class="axis" x="${PAD.left - 6}" y="${Number(gy) + 3}" text-anchor="end">${Math.round(ms)}</text>`,
    );
  }

  const degradedRule =
    degradedMs !== undefined && degradedMs < top
      ? `<line class="grid" stroke-dasharray="4 4" x1="${PAD.left}" y1="${y(degradedMs).toFixed(
          1,
        )}" x2="${W - PAD.right}" y2="${y(degradedMs).toFixed(1)}" />`
      : "";

  // Only the samples that were not healthy get a dot — the eye should land on
  // the problems, not on 700 identical markers.
  const marks = samples
    .filter((s) => s.s !== "up")
    .map(
      (s) =>
        `<circle class="dot-${s.s}" cx="${x(s.t).toFixed(1)}" cy="${y(s.ms).toFixed(1)}" r="3" />`,
    )
    .join("");

  const area =
    samples.length > 1
      ? `<path class="area" d="M${points[0]} L${points.join(" L")} L${x(last).toFixed(1)},${(
          PAD.top + PLOT_H
        ).toFixed(1)} L${x(first).toFixed(1)},${(PAD.top + PLOT_H).toFixed(1)} Z" />`
      : "";

  const line =
    samples.length > 1
      ? `<path class="line" d="M${points.join(" L")}" />`
      : `<circle class="line" fill="#6366f1" cx="${points[0].split(",")[0]}" cy="${
          points[0].split(",")[1]
        }" r="3" />`;

  const mean = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const subtitle = `mean ${mean} ms · peak ${Math.round(Math.max(...values))} ms · ${
    samples.length
  } sample${samples.length === 1 ? "" : "s"}`;

  return wrap(
    [
      header,
      `<text class="sub" x="${W - PAD.right}" y="18" text-anchor="end">${esc(subtitle)}</text>`,
      ...gridLines,
      degradedRule,
      area,
      line,
      marks,
      `<text class="axis" x="${PAD.left}" y="${H - 8}">${shortDate(first)}</text>`,
      `<text class="axis" x="${W - PAD.right}" y="${H - 8}" text-anchor="end">${shortDate(last)}</text>`,
      `<text class="axis" x="${PAD.left - 6}" y="${PAD.top - 8}" text-anchor="end">ms</text>`,
    ].join(""),
  );
}

function wrap(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Response time over time">
<style>${STYLE}</style>
<defs>
  <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#6366f1" stop-opacity="0.28" />
    <stop offset="100%" stop-color="#6366f1" stop-opacity="0" />
  </linearGradient>
</defs>
<rect class="bg" width="${W}" height="${H}" rx="8" />
${body}
</svg>
`;
}
