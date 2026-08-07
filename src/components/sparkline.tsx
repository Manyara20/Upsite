import type { CheckResult } from "@/lib/types";

/**
 * A latency sparkline drawn as raw SVG rather than a chart library — there is
 * one of these per card, and Recharts' machinery is not worth paying for at
 * this size. No axes, no legend: the card's stats carry the numbers, this
 * carries the shape.
 */
export function Sparkline({
  checks,
  color = "#22d3ee",
  width = 240,
  height = 40,
}: {
  checks: CheckResult[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const points = checks.slice(-60);

  if (points.length < 2) {
    return (
      <div className="flex h-10 items-center text-[11px] text-ink-faint">
        Gathering samples…
      </div>
    );
  }

  const values = points.map((p) => p.ms);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero and collapse onto the baseline.
  const span = max - min || 1;
  const pad = 3;
  const usable = height - pad * 2;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = pad + usable - ((p.ms - min) / span) * usable;
    return { x, y, check: p };
  });

  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const id = `spark-${points[0].t}`;

  // Failures are the only points worth marking individually.
  const failures = coords.filter((c) => c.check.s === "down");

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Latency trend over the last ${points.length} checks`}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {failures.map((c) => (
        <circle
          key={c.check.t}
          cx={c.x}
          cy={c.y}
          r="2.5"
          fill="#fb7185"
          // A surface-colored ring keeps the marker legible over the line.
          stroke="#0c111d"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
