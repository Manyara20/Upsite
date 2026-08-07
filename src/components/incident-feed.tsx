"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ShieldAlert, TriangleAlert } from "lucide-react";
import { cn, formatDateTime, formatDuration } from "@/lib/format";
import type { Incident } from "@/lib/types";

/**
 * The incident log. Ongoing incidents sort to the top and keep their status
 * color; resolved ones cool down to a neutral ink so the eye goes to what is
 * still broken.
 */
export function IncidentFeed({
  incidents,
  names,
  limit = 12,
}: {
  incidents: Incident[];
  /** monitor id → display name */
  names: Record<string, string>;
  limit?: number;
}) {
  const sorted = [...incidents]
    .sort((a, b) => {
      const aOpen = a.endedAt ? 0 : 1;
      const bOpen = b.endedAt ? 0 : 1;
      if (aOpen !== bOpen) return bOpen - aOpen;
      return b.startedAt - a.startedAt;
    })
    .slice(0, limit);

  if (sorted.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-up/20 bg-up/5 px-4 py-3 text-sm text-ink-dim">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-up" />
        No incidents recorded. Every check has passed since monitoring began.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      <AnimatePresence initial={false}>
        {sorted.map((incident) => {
          const ongoing = !incident.endedAt;
          const Icon = incident.severity === "down" ? ShieldAlert : TriangleAlert;
          const tone = incident.severity === "down" ? "text-down" : "text-degraded";

          return (
            <motion.li
              key={incident.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className={cn(
                "glass flex items-start gap-3 rounded-xl border px-4 py-3",
                ongoing ? (incident.severity === "down" ? "border-down/30" : "border-degraded/30") : "border-edge",
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ongoing ? tone : "text-ink-faint")} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/monitor/${incident.monitorId}`}
                    className="text-sm font-medium text-ink hover:text-signal"
                  >
                    {names[incident.monitorId] ?? incident.monitorId}
                  </Link>
                  <span className={cn("text-[11px] font-medium", ongoing ? tone : "text-ink-faint")}>
                    {ongoing
                      ? incident.severity === "down"
                        ? "Ongoing outage"
                        : "Ongoing degradation"
                      : "Resolved"}
                  </span>
                </div>

                <p className="mt-0.5 truncate font-mono text-[11px] text-ink-dim">
                  {incident.reason}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <div className="font-mono text-[11px] text-ink-dim">
                  {formatDuration((incident.endedAt ?? Date.now()) - incident.startedAt)}
                </div>
                <div className="mt-0.5 text-[10px] text-ink-faint">
                  {formatDateTime(incident.startedAt)}
                </div>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
