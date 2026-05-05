"use client";
// Pediatrics — sub-tab Hábitos. Spec: §1.10, §4.A.5

import { useState } from "react";
import { Plus } from "lucide-react";
import { HabitsTimeline } from "../charts/HabitsTimeline";
import { HabitDrawer } from "../drawers/HabitDrawer";
import type { OralHabitRow } from "@/types/pediatrics";

export interface HabitsSectionProps {
  patientId: string;
  patientDob: Date;
  habits: OralHabitRow[];
}

export function HabitsSection(props: HabitsSectionProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const active = props.habits.filter((h) => !h.deletedAt && !h.endedAt);

  return (
    <div className="pedi-section">
      <div className="pedi-section__header">
        <h2 className="pedi-section__title">Hábitos orales</h2>
        <button type="button" className="pedi-btn" onClick={() => setDrawerOpen(true)}>
          <Plus size={14} aria-hidden /> Hábito
        </button>
      </div>

      <HabitsTimeline patientDob={props.patientDob} habits={props.habits} />

      <details open className="pedi-form__section">
        <summary>Hábitos activos ({active.length})</summary>
        {active.length === 0 ? (
          <p className="pedi-card__empty">Sin hábitos activos.</p>
        ) : (
          <table className="pedi-table">
            <thead>
              <tr><th>Tipo</th><th>Frecuencia</th><th>Desde</th><th>Intervención</th><th>Notas</th></tr>
            </thead>
            <tbody>
              {active.map((h) => (
                <tr key={h.id}>
                  <td>{labelHabit(h.habitType)}</td>
                  <td className="pedi-table__cap">{h.frequency}</td>
                  <td>{h.startedAt.toLocaleDateString("es-MX", { month: "short", year: "numeric" })}</td>
                  <td>{h.intervention ?? "—"}</td>
                  <td>{h.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>

      <HabitDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        patientId={props.patientId}
      />
    </div>
  );
}

function labelHabit(t: string): string {
  const m: Record<string, string> = {
    succion_digital: "Succión digital",
    chupon: "Chupón",
    biberon_nocturno: "Biberón nocturno",
    respiracion_bucal: "Respiración bucal",
    bruxismo_nocturno: "Bruxismo nocturno",
    onicofagia: "Onicofagia",
    deglucion_atipica: "Deglución atípica",
  };
  return m[t] ?? t;
}
