import { cn, STATUS_STYLE } from "@/lib/format";
import type { MonitorStatus } from "@/lib/types";

/**
 * The status indicator. A live monitor gets an expanding halo behind the dot;
 * paused and pending ones stay still, so motion always means "being watched".
 */
export function StatusDot({
  status,
  size = "md",
  className,
}: {
  status: MonitorStatus;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const style = STATUS_STYLE[status];
  const animated = status === "up" || status === "degraded" || status === "down";

  const dimensions = {
    sm: "h-1.5 w-1.5",
    md: "h-2.5 w-2.5",
    lg: "h-3.5 w-3.5",
  }[size];

  return (
    <span className={cn("relative inline-flex shrink-0", dimensions, className)}>
      {animated && (
        <span
          className={cn(
            "animate-pulse-ring absolute inline-flex h-full w-full rounded-full opacity-70",
            style.dot,
          )}
        />
      )}
      <span className={cn("relative inline-flex h-full w-full rounded-full", style.dot)} />
    </span>
  );
}
