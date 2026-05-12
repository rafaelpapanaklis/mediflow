// KPI card con label + value + delta + sub + accent · design/atoms.jsx atom 2.

import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatCardKPIProps {
  label: string;
  value: string | number;
  delta?: number | null;
  sub?: string;
  accent?: boolean;
}

export function StatCardKPI({ label, value, delta, sub, accent }: StatCardKPIProps) {
  const DeltaIcon = delta == null || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const deltaClass =
    delta == null || delta === 0
      ? "text-muted-foreground"
      : delta > 0
        ? "text-emerald-600"
        : "text-rose-600";

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-2xl border bg-card p-4 shadow-sm min-h-[88px] ${
        accent ? "border-blue-500 shadow-[0_0_0_1px_rgba(45,127,249,.4),_0_0_24px_rgba(45,127,249,.18)]" : "border-border"
      }`}
    >
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </span>
      <span className="text-2xl font-semibold text-foreground tracking-tight leading-tight">
        {value}
      </span>
      <div className="flex items-center gap-2 text-[11px]">
        {delta != null && (
          <span className={`inline-flex items-center gap-1 font-mono font-medium ${deltaClass}`}>
            <DeltaIcon className="h-3 w-3" />
            {Math.abs(delta)}%
          </span>
        )}
        {sub && <span className="text-muted-foreground font-mono">{sub}</span>}
      </div>
    </div>
  );
}
