"use client";
// Pediatrics — sub-tab Conducta (Frankl/Venham). Spec: §1.11, §4.A.5

import { useMemo, useState } from "react";
import { Plus, AlertTriangle } from "lucide-react";
import { FranklTrendChart, type BehaviorScale } from "../charts/FranklTrendChart";
import { FranklDrawer } from "../drawers/FranklDrawer";
import { detectRegression } from "@/lib/pediatrics/frankl";
import type { BehaviorAssessmentRow } from "@/types/pediatrics";

export interface BehaviorSectionProps {
  patientId: string;
  history: BehaviorAssessmentRow[];
}

export function BehaviorSection(props: BehaviorSectionProps) {
  const [scale, setScale] = useState<BehaviorScale>("frankl");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(
    () => props.history.filter((h) => h.scale === scale && !h.deletedAt).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime()),
    [props.history, scale],
  );

  const regression = useMemo(
    () => detectRegression(filtered.map((h) => ({ value: h.value, date: h.recordedAt }))),
    [filtered],
  );

  const series = filtered.map((h, i) => ({
    index: i + 1,
    date: h.recordedAt,
    value: h.value,
    notes: h.notes,
  }));

  return (
    <div className="pedi-section">
      <div className="pedi-section__header">
        <h2 className="pedi-section__title">Comportamiento — {scale === "frankl" ? "Frankl" : "Venham"}</h2>
        <div className="pedi-section__actions">
          <div className="pedi-form__pillgroup">
            {(["frankl", "venham"] as BehaviorScale[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`pedi-pill ${scale === s ? "is-active" : ""}`}
                onClick={() => setScale(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" className="pedi-btn" onClick={() => setDrawerOpen(true)}>
            <Plus size={14} aria-hidden /> Captura
          </button>
        </div>
      </div>

      {regression.detected && regression.severity === "severe" ? (
        <div className="pedi-section__alert" role="alert">
          <AlertTriangle size={14} aria-hidden />
          Regresión conductual detectada — considera ajustar duración de cita.
        </div>
      ) : null}

      <FranklTrendChart scale={scale} data={series} />

      <details open className="pedi-form__section">
        <summary>Histórico ({filtered.length})</summary>
        {filtered.length === 0 ? (
          <p className="pedi-card__empty">Sin capturas todavía.</p>
        ) : (
          <table className="pedi-table">
            <thead>
              <tr><th>Fecha</th><th>Valor</th><th>Notas</th></tr>
            </thead>
            <tbody>
              {[...filtered].reverse().map((h) => (
                <tr key={h.id}>
                  <td>{h.recordedAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td><span className={`frankl-pill frankl-pill--${h.value}`}>{h.value}</span></td>
                  <td>{h.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>

      <FranklDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} patientId={props.patientId} />
    </div>
  );
}
