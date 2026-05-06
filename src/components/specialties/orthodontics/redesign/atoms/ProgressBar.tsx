// Atom: Progress bar simple.

type Color = "violet" | "emerald" | "amber" | "rose";

const COLORS: Record<Color, string> = {
  violet: "bg-violet-600",
  emerald: "bg-emerald-600",
  amber: "bg-amber-500",
  rose: "bg-rose-600",
};

export interface ProgressBarProps {
  value: number;
  max?: number;
  color?: Color;
  className?: string;
  ariaLabel?: string;
}

export function ProgressBar({
  value,
  max = 100,
  color = "violet",
  className = "",
  ariaLabel,
}: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      className={`w-full h-1.5 bg-slate-100 rounded-full overflow-hidden dark:bg-slate-800 ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div
        className={`h-full ${COLORS[color]} rounded-full transition-all`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
