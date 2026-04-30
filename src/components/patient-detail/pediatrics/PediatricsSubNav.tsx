"use client";
// Pediatrics — sub-nav interno entre las 6 sections. Spec: §1.6, §4.A.4

import { Grid2x2, LayoutDashboard, LineChart, ListChecks, ShieldCheck, Smile } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type PediatricsTabKey =
  | "summary" | "odontogram" | "eruption" | "habits" | "behavior" | "preventive";

const TABS: Array<{ k: PediatricsTabKey; label: string; Icon: LucideIcon }> = [
  { k: "summary",    label: "Resumen",        Icon: LayoutDashboard },
  { k: "odontogram", label: "Odontograma",    Icon: Grid2x2 },
  { k: "eruption",   label: "Erupción",       Icon: LineChart },
  { k: "habits",     label: "Hábitos",        Icon: ListChecks },
  { k: "behavior",   label: "Conducta",       Icon: Smile },
  { k: "preventive", label: "Plan preventivo",Icon: ShieldCheck },
];

export interface PediatricsSubNavProps {
  active: PediatricsTabKey;
  onChange: (key: PediatricsTabKey) => void;
  counts?: Partial<Record<PediatricsTabKey, number>>;
}

export function PediatricsSubNav(props: PediatricsSubNavProps) {
  const { active, onChange, counts } = props;
  return (
    <div className="pedi-subnav" role="tablist" aria-label="Sub-secciones de pediatría">
      {TABS.map((t) => {
        const isActive = active === t.k;
        const count = counts?.[t.k] ?? 0;
        return (
          <button
            key={t.k}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`pedi-subnav__tab ${isActive ? "is-active" : ""}`}
            onClick={() => onChange(t.k)}
          >
            <t.Icon size={14} aria-hidden />
            <span>{t.label}</span>
            {count > 0 ? <span className="pedi-subnav__count">{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
