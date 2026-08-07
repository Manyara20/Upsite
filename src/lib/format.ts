import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { MonitorStatus } from "./types";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Percentages are shown to 2dp above 99% and 1dp below — precision where it matters. */
export function formatUptime(ratio: number | null): string {
  if (ratio === null) return "—";
  const pct = ratio * 100;
  if (pct >= 99) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Compact elapsed time, e.g. "3d 4h", "12m", "just now". */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s`;

  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;

  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;

  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export function formatSince(epochMs: number | undefined): string {
  if (!epochMs) return "—";
  return formatDuration(Date.now() - epochMs);
}

export function formatClock(epochMs: number | undefined): string {
  if (!epochMs) return "—";
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export const STATUS_LABEL: Record<MonitorStatus, string> = {
  up: "Operational",
  degraded: "Degraded",
  down: "Outage",
  paused: "Paused",
  pending: "Awaiting first check",
};

/**
 * Tailwind classes per status, resolved in one place so a colour never drifts
 * between the card, the header and the detail page.
 */
export const STATUS_STYLE: Record<
  MonitorStatus,
  { text: string; bg: string; border: string; dot: string; glow: string; hex: string }
> = {
  up: {
    text: "text-up",
    bg: "bg-up/10",
    border: "border-up/30",
    dot: "bg-up",
    glow: "text-glow-up",
    hex: "#34d399",
  },
  degraded: {
    text: "text-degraded",
    bg: "bg-degraded/10",
    border: "border-degraded/30",
    dot: "bg-degraded",
    glow: "text-glow-degraded",
    hex: "#fbbf24",
  },
  down: {
    text: "text-down",
    bg: "bg-down/10",
    border: "border-down/30",
    dot: "bg-down",
    glow: "text-glow-down",
    hex: "#fb7185",
  },
  paused: {
    text: "text-paused",
    bg: "bg-paused/10",
    border: "border-paused/30",
    dot: "bg-paused",
    glow: "",
    hex: "#64748b",
  },
  pending: {
    text: "text-ink-faint",
    bg: "bg-paused/10",
    border: "border-paused/30",
    dot: "bg-paused",
    glow: "",
    hex: "#56637d",
  },
};
