"use client";
// Endodontics — lista de controles pendientes filtrable por mes. Spec §6.16, §11.4

import Link from "next/link";
import { CalendarClock } from "lucide-react";

const MILESTONE_LABEL: Record<string, string> = {
  CONTROL_6M: "6 meses",
  CONTROL_12M: "12 meses",
  CONTROL_24M: "24 meses",
  CONTROL_EXTRA: "Extra",
};

export interface PendingFollowUpRow {
  id: string;
  patientId: string;
  patientName: string;
  toothFdi: number;
  milestone: string;
  scheduledAt: Date;
  doctorName: string | null;
  daysOverdue: number;
}

export interface PendingFollowUpsListProps {
  rows: PendingFollowUpRow[];
}

export function PendingFollowUpsList({ rows }: PendingFollowUpsListProps) {
  if (rows.length === 0) {
    return (
      <div className="endo-section">
        <p className="endo-section__eyebrow">Controles pendientes</p>
        <p className="endo-section__placeholder">Sin controles pendientes. Buen trabajo.</p>
      </div>
    );
  }

  return (
    <section className="endo-section">
      <header className="endo-pending__header">
        <p className="endo-section__eyebrow">Controles pendientes</p>
        <h2 className="endo-section__title">
          {rows.length} {rows.length === 1 ? "control" : "controles"} programados
        </h2>
      </header>
      <table className="endo-table">
        <thead>
          <tr>
            <th>Paciente</th>
            <th>Diente</th>
            <th>Control</th>
            <th>Fecha</th>
            <th>Retraso</th>
            <th>Doctor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/dashboard/specialties/endodontics/${r.patientId}`}>
                  {r.patientName}
                </Link>
              </td>
              <td className="endo-table__mono">{r.toothFdi}</td>
              <td>
                <span className="endo-pending__chip">
                  <CalendarClock size={11} aria-hidden /> {MILESTONE_LABEL[r.milestone] ?? r.milestone}
                </span>
              </td>
              <td>{r.scheduledAt.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td className={r.daysOverdue > 30 ? "endo-pending__overdue" : ""}>
                {r.daysOverdue > 0 ? `${r.daysOverdue} días` : "—"}
              </td>
              <td>{r.doctorName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
