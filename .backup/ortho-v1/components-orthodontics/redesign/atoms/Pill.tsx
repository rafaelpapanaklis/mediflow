// Atom: Pill / badge para chips inline (fase, mes, status).

import type { ReactNode } from "react";

export type PillColor = "slate" | "violet" | "emerald" | "amber" | "rose" | "sky" | "white";
type PillSize = "xs" | "sm";

const COLORS: Record<PillColor, string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  white: "bg-white text-slate-700 border border-slate-200 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300",
};

const SIZES: Record<PillSize, string> = {
  xs: "text-[10px] px-1.5 py-0.5",
  sm: "text-xs px-2 py-0.5",
};

export interface PillProps {
  children: ReactNode;
  color?: PillColor;
  size?: PillSize;
  className?: string;
}

export function Pill({ children, color = "slate", size = "sm", className = "" }: PillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${COLORS[color]} ${SIZES[size]} ${className}`}
    >
      {children}
    </span>
  );
}
