"use client";
// Endodontics — TC sin restauración definitiva. Banner rojo si >30 días. Spec §11.5

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export interface PendingRestorationRow {
  treatmentId: string;
  patientId: string;
  patientName: string;
  toothFdi: number;
  completedAt: Date;
  daysSinceCompletion: number;
  postOpRestorationPlan: string | null;
}

const PLAN_LABEL: Record<string, string> = {
  CORONA_PORCELANA_METAL: "Corona PMC",
  CORONA_ZIRCONIA: "Corona zirconia",
  CORONA_DISILICATO_LITIO: "Corona disilicato",
  ONLAY: "Onlay",
  RESTAURACION_DIRECTA_RESINA: "Resina directa",
  POSTE_FIBRA_CORONA: "Poste fibra + corona",
  POSTE_METALICO_CORONA: "Poste metálico + corona",
};

export function PendingRestorationList({ rows }: { rows: PendingRestorationRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="endo-section">
        <p className="endo-section__eyebrow">Restauración pos-TC</p>
        <p className="endo-section__placeholder">Todos los TC tienen restauración registrada.</p>
      </div>
    );
  }

  return (
    <section className="endo-section">
      <header className="endo-pending__header">
        <p className="endo-section__eyebrow">Restauración pos-TC pendiente</p>
        <h2 className="endo-section__title">
          {rows.length} {rows.length === 1 ? "tratamiento" : "tratamientos"} sin restaurar
        </h2>
      </header>
      <table className="endo-table">
        <thead>
          <tr>
            <th>Paciente</th>
            <th>Diente</th>
            <th>Plan</th>
            <th>Días desde TC</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.treatmentId} className={r.daysSinceCompletion > 30 ? "endo-pending__row--alert" : ""}>
              <td>
                <Link href={`/dashboard/specialties/endodontics/${r.patientId}`}>
                  {r.patientName}
                </Link>
              </td>
              <td className="endo-table__mono">{r.toothFdi}</td>
              <td>{r.postOpRestorationPlan ? PLAN_LABEL[r.postOpRestorationPlan] ?? r.postOpRestorationPlan : "—"}</td>
              <td>
                {r.daysSinceCompletion}
                {r.daysSinceCompletion > 30 ? (
                  <span className="endo-pending__alert">
                    <AlertTriangle size={11} aria-hidden /> Riesgo fractura
                  </span>
                ) : null}
              </td>
              <td>
                <Link
                  href={`/dashboard/specialties/endodontics/${r.patientId}`}
                  className="pedi-btn pedi-btn--xs"
                >
                  Abrir expediente
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
