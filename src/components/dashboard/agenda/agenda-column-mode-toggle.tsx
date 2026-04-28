"use client";

import { useAgenda } from "./agenda-provider";
import type { AgendaColumnMode } from "@/lib/agenda/types";

const OPTIONS: Array<{ value: AgendaColumnMode; label: string }> = [
  { value: "doctor", label: "Por profesional" },
  { value: "resource", label: "Por sillón" },
  { value: "unified", label: "Unificada" },
];

export function AgendaColumnModeToggle() {
  const { state, setColumnMode } = useAgenda();
  const hasResources = state.resources.length > 0;
  const activeDoctorCount = state.doctors.filter((d) => d.activeInAgenda).length;
  const hasDoctors = activeDoctorCount > 1;

  const available = OPTIONS.filter((o) => {
    if (o.value === "resource") return hasResources;
    if (o.value === "doctor") return hasDoctors;
    return true;
  });

  if (available.length <= 1) return null;

  return (
    <div role="tablist" aria-label="Modo de columnas" className="segment-new">
      {available.map((opt) => {
        const active = state.columnMode === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`segment-new__btn ${active ? "segment-new__btn--active" : ""}`}
            onClick={() => setColumnMode(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
