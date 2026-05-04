"use client";
// Periodontics — barra de sub-tabs del módulo. SPEC §6.1.

import { useState } from "react";

export type PerioTabKey = "resumen" | "periodontograma" | "plan" | "cirugias" | "mantenimientos";

const TABS: { key: PerioTabKey; label: string }[] = [
  { key: "resumen", label: "Resumen" },
  { key: "periodontograma", label: "Periodontograma" },
  { key: "plan", label: "Plan" },
  { key: "cirugias", label: "Cirugías" },
  { key: "mantenimientos", label: "Mantenimientos" },
];

export function PerioSubTabs(props: {
  active: PerioTabKey;
  onChange: (key: PerioTabKey) => void;
}) {
  return (
    <nav
      role="tablist"
      style={{
        display: "flex",
        gap: 4,
        borderBottom: "1px solid var(--border, #1f2937)",
        marginBottom: 16,
      }}
    >
      {TABS.map((t) => {
        const isActive = props.active === t.key;
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
              borderBottom: isActive
                ? "2px solid var(--brand, #6366f1)"
                : "2px solid transparent",
              color: isActive ? "var(--text-1, #e5e7eb)" : "var(--text-2, #94a3b8)",
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

export function usePerioTab(initial: PerioTabKey = "resumen") {
  return useState<PerioTabKey>(initial);
}
