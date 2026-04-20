"use client";

import type { LucideIcon } from "lucide-react";

type KpiCardProps = {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down"; sub?: string };
  icon?: LucideIcon;
};

export function KpiCard({ label, value, delta, icon: Icon }: KpiCardProps) {
  return (
    <div className="kpi">
      <div className="kpi__top">
        <span className="kpi__label">{label}</span>
        {Icon && (
          <div className="kpi__icon">
            <Icon size={14} />
          </div>
        )}
      </div>
      <div className="kpi__value">{value}</div>
      {delta && (
        <div className={`kpi__delta kpi__delta--${delta.direction}`}>
          {delta.direction === "up" ? "↑" : "↓"} {delta.value}
          {delta.sub && <span className="kpi__delta-sub">{delta.sub}</span>}
        </div>
      )}
    </div>
  );
}
