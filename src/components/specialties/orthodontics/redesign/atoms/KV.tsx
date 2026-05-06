// Atom: KeyValue (etiqueta gris pequeña + valor sólido).

import type { ReactNode } from "react";

export interface KVProps {
  k: ReactNode;
  v: ReactNode;
  className?: string;
  vClass?: string;
}

export function KV({ k, v, className = "", vClass = "text-slate-900 font-medium dark:text-slate-100" }: KVProps) {
  return (
    <div className={`flex justify-between items-baseline gap-3 py-1 ${className}`}>
      <span className="text-xs text-slate-500 dark:text-slate-400">{k}</span>
      <span className={`text-sm ${vClass}`}>{v}</span>
    </div>
  );
}
