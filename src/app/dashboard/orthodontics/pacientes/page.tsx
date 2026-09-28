// Ortodoncia — Pacientes en tratamiento (ws1-t2, Ola 1). La lista de casos
// activos, con su fase y su cobranza real (factura del tratamiento, decisión
// 1 de la arquitectura). La guarda de módulo ya corrió en el layout.
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { loadOrthoCases } from "@/lib/orthodontics/tablero-data";
import { ACTIVE_PLAN_STATUSES } from "@/lib/orthodontics/specialty-kpis";
import { OrthoPacientesTable, type OrthoPacienteRow } from "@/components/specialties/orthodontics/OrthoPacientesTable";

export default async function OrthodonticsPacientesPage() {
  const user = await getCurrentUser();
  const { cases } = await loadOrthoCases(user.clinicId, user.clinic.timezone);

  const rows: OrthoPacienteRow[] = cases
    .filter((c) => ACTIVE_PLAN_STATUSES.includes(c.status))
    .map((c) => ({
      planId: c.planId,
      patientId: c.patientId,
      patientName: c.patientName,
      treatingDoctorName: c.treatingDoctorName,
      status: c.status as OrthoPacienteRow["status"],
      overdueAmountMxn: Math.round(c.cobranza?.vencidas.reduce((s, q) => s + q.falta, 0) ?? 0),
      nextDueDate: c.cobranza?.proximoVencimiento ?? null,
    }))
    .sort((a, b) => a.patientName.localeCompare(b.patientName));

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-1)" }}>Pacientes en tratamiento</h1>
        <p style={{ margin: 0, marginTop: 2, fontSize: 12, color: "var(--text-3)" }}>
          {rows.length} caso{rows.length === 1 ? "" : "s"} activo{rows.length === 1 ? "" : "s"}.
        </p>
      </header>
      <OrthoPacientesTable rows={rows} />
    </div>
  );
}
