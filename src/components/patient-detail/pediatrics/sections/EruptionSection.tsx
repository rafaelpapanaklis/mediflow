"use client";
// Pediatrics — sub-tab Erupción. Spec: §1.9, §4.A.5

import { useState } from "react";
import { Plus } from "lucide-react";
import { EruptionChart } from "../charts/EruptionChart";
import { EruptionDrawer } from "../drawers/EruptionDrawer";
import type { EruptionRecordRow } from "@/types/pediatrics";

export interface EruptionSectionProps {
  patientId: string;
  patientAgeMonths: number;
  records: EruptionRecordRow[];
}

export function EruptionSection(props: EruptionSectionProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [presetFdi, setPresetFdi] = useState<number | null>(null);

  function open(fdi?: number) {
    setPresetFdi(fdi ?? null);
    setDrawerOpen(true);
  }

  const sorted = [...props.records]
    .filter((r) => !r.deletedAt)
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());

  return (
    <div className="pedi-section">
      <div className="pedi-section__header">
        <h2 className="pedi-section__title">Cronología de erupción</h2>
        <button type="button" className="pedi-btn" onClick={() => open()}>
          <Plus size={14} aria-hidden /> Registrar
        </button>
      </div>

      <EruptionChart
        patientAgeMonths={props.patientAgeMonths}
        records={props.records}
        onToothClick={(fdi) => open(fdi)}
      />

      <details className="pedi-form__section">
        <summary>Histórico ({sorted.length} {sorted.length === 1 ? "registro" : "registros"})</summary>
        {sorted.length === 0 ? (
          <p className="pedi-card__empty">Aún no hay erupciones registradas.</p>
        ) : (
          <table className="pedi-table">
            <thead>
              <tr><th>FDI</th><th>Observado</th><th>Edad</th><th>Desviación</th><th>Notas</th></tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td className="pedi-table__mono">{r.toothFdi}</td>
                  <td>{r.observedAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td className="pedi-table__mono">{Number(r.ageAtEruptionDecimal).toFixed(2)}a</td>
                  <td>{labelDeviation(r.deviation)}</td>
                  <td>{r.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>

      <EruptionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        patientId={props.patientId}
        initialFdi={presetFdi}
      />
    </div>
  );
}

function labelDeviation(d: string): string {
  if (d === "within") return "En rango";
  if (d === "mild") return "Desviación leve";
  if (d === "early") return "Erupción temprana";
  if (d === "pathological") return "Patológica";
  return d;
}
