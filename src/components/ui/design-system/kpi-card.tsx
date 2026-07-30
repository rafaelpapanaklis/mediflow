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
  /**
   * Tiñe SOLO el número, para señalar un consumo alto (cupo del plan al 80%/100%).
   * Sin tone el valor conserva var(--text-1); son tokens, así que funciona en
   * light y en dark sin tocar globals.css.
   */
  tone?: "warning" | "danger";
};

const TONE_COLOR: Record<"warning" | "danger", string> = {
  warning: "var(--warning)",
  danger: "var(--danger)",
};

export function KpiCard({ label, value, delta, icon: Icon, hero, tone }: KpiCardProps) {
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
      <div className="kpi__value" style={tone ? { color: TONE_COLOR[tone] } : undefined}>{value}</div>
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
