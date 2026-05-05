"use client";
// Orthodontics — sub-tabs del módulo. SPEC §6.4.

import { useState } from "react";

export type OrthoTabKey = "diagnostico" | "plan" | "fotos" | "controles" | "pagos";

export interface OrthoTab {
  key: OrthoTabKey;
  label: string;
  count?: number | string | null;
}

const DEFAULT_TABS: OrthoTab[] = [
  { key: "diagnostico", label: "Diagnóstico" },
  { key: "plan", label: "Plan" },
  { key: "fotos", label: "Fotos" },
  { key: "controles", label: "Controles" },
  { key: "pagos", label: "Pagos" },
];

export function OrthoSubTabs(props: {
  active: OrthoTabKey;
  onChange: (key: OrthoTabKey) => void;
  counts?: Partial<Record<OrthoTabKey, number | string>>;
}) {
  const tabs = DEFAULT_TABS.map((t) => ({ ...t, count: props.counts?.[t.key] }));
  return (
    <nav
      role="tablist"
      style={{
        display: "flex",
        gap: 4,
        borderBottom: "1px solid var(--border)",
        marginBottom: 16,
        overflowX: "auto",
      }}
    >
      {tabs.map((t) => {
        const isActive = t.key === props.active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => props.onChange(t.key)}
            style={{
              padding: "10px 16px",
              background: "transparent",
              border: "none",
              borderBottom: isActive ? "2px solid var(--brand, #6366f1)" : "2px solid transparent",
              color: isActive ? "var(--text-1)" : "var(--text-2)",
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              marginBottom: -1,
              whiteSpace: "nowrap",
            }}
          >
            {t.label}
            {t.count !== undefined && t.count !== null && t.count !== 0 ? (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 8,
                  background: isActive ? "var(--brand-soft, rgba(99,102,241,0.18))" : "var(--bg)",
                  color: isActive ? "var(--brand, #6366f1)" : "var(--text-3)",
                }}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

export function useOrthoTab(initial: OrthoTabKey = "diagnostico") {
  return useState<OrthoTabKey>(initial);
}
