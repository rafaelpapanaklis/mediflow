// Server-safe: no hooks ni event handlers → no "use client".
// Pasar un LucideIcon como prop desde un Server Component fallaba con el error
// "Functions cannot be passed directly to Client Components" cuando este
// archivo estaba marcado como "use client".

import { ArrowUpRight, ArrowDownRight, type LucideIcon } from "lucide-react";

type KpiCardProps = {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down"; sub?: string };
  icon?: LucideIcon;
  /** KPI primario del grupo: chip del icono con degradado de marca (solo UNO por fila). */
  hero?: boolean;
};

export function KpiCard({ label, value, delta, icon: Icon, hero }: KpiCardProps) {
  return (
    <div className={hero ? "kpi kpi--hero" : "kpi"}>
      <div className="kpi__top">
        <span className="kpi__label">{label}</span>
        {Icon && (
          <div className="kpi__icon">
            <Icon size={17} strokeWidth={1.75} />
          </div>
        )}
      </div>
      <div className="kpi__value">{value}</div>
      {delta && (
        <div className={`kpi__delta kpi__delta--${delta.direction}`}>
          {delta.direction === "up"
            ? <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
            : <ArrowDownRight size={14} strokeWidth={2} aria-hidden />}
          {delta.value}
          {delta.sub && <span className="kpi__delta-sub">{delta.sub}</span>}
        </div>
      )}
    </div>
  );
}
