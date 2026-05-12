// Atom: KpiTile — tile estilo "KPI dashboard" del producto MediFlow.
// Label small caps + icon en badge + valor grande + delta + sub.

import type { ReactNode } from "react";

type Tone = "violet" | "emerald" | "amber" | "rose" | "sky";

const ICON_BG: Record<Tone, string> = {
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300",
  sky: "bg-sky-50 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300",
};

const DELTA_COLOR: Record<"emerald" | "rose" | "amber", string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  rose: "text-rose-600 dark:text-rose-400",
  amber: "text-amber-600 dark:text-amber-400",
};

export interface KpiTileProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  delta?: ReactNode;
  deltaTone?: "emerald" | "rose" | "amber";
  className?: string;
}

export function KpiTile({
  label,
  value,
  sub,
  icon,
  tone = "violet",
  delta,
  deltaTone = "emerald",
  className = "",
}: KpiTileProps) {
  return (
    <div
      className={`bg-white border border-slate-200 rounded-lg p-5 dark:bg-slate-900 dark:border-slate-800 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide dark:text-slate-400">
          {label}
        </div>
        {icon ? (
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center ${ICON_BG[tone]}`}
            aria-hidden
          >
            {icon}
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
          {value}
        </span>
        {delta ? <span className={`text-sm ${DELTA_COLOR[deltaTone]}`}>{delta}</span> : null}
      </div>
      {sub ? (
        <div className="mt-1 text-sm text-slate-400 dark:text-slate-500">{sub}</div>
      ) : null}
    </div>
  );
}
