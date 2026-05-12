// Atom: Stat (etiqueta uppercase + valor mono grande + sub + delta opcional).
// Utilizado en hero y headers de sección.

import type { ReactNode } from "react";

type DeltaColor = "emerald" | "rose" | "amber";

const DELTA: Record<DeltaColor, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  rose: "text-rose-600 dark:text-rose-400",
  amber: "text-amber-600 dark:text-amber-400",
};

export interface StatChipProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  deltaColor?: DeltaColor;
  className?: string;
}

export function StatChip({
  label,
  value,
  sub,
  delta,
  deltaColor = "emerald",
  className = "",
}: StatChipProps) {
  return (
    <div className={className}>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100">
          {value}
        </span>
        {delta ? <span className={`text-xs ${DELTA[deltaColor]}`}>{delta}</span> : null}
      </div>
      {sub ? (
        <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">{sub}</div>
      ) : null}
    </div>
  );
}
