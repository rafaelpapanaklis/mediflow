"use client";
// Implants — navegación de sub-tabs: Implantes | Cirugías y aumentos |
// Mantenimiento. Spec §1.1.

import { useState } from "react";

export type ImplantsSubTab = "implants" | "surgeries" | "maintenance";

export interface ImplantsSubTabsProps {
  initial?: ImplantsSubTab;
  implantsContent: React.ReactNode;
  surgeriesContent: React.ReactNode;
  maintenanceContent: React.ReactNode;
}

const TABS: Array<{ key: ImplantsSubTab; label: string }> = [
  { key: "implants", label: "Implantes" },
  { key: "surgeries", label: "Cirugías y aumentos" },
  { key: "maintenance", label: "Mantenimiento" },
];

export function ImplantsSubTabs({
  initial = "implants",
  implantsContent,
  surgeriesContent,
  maintenanceContent,
}: ImplantsSubTabsProps) {
  const [active, setActive] = useState<ImplantsSubTab>(initial);

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-1 border-b border-[var(--border-soft,theme(colors.gray.200))] dark:border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            onClick={() => setActive(t.key)}
            className={[
              "px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
              active === t.key
                ? "border-blue-500 text-blue-700 dark:text-blue-300"
                : "border-transparent text-[var(--text-2,theme(colors.gray.600))] hover:text-[var(--text-1,theme(colors.gray.900))]",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {active === "implants" && implantsContent}
        {active === "surgeries" && surgeriesContent}
        {active === "maintenance" && maintenanceContent}
      </div>
    </div>
  );
}
