// Ortodoncia — Pacientes en tratamiento (ws1-t2, Ola 1). La lista de casos
// activos, con su fase y su cobranza real (factura del tratamiento, decisión
// 1 de la arquitectura). La guarda de módulo corre en el layout y, otra vez, aquí.
//
// Diseño (ws1-t3): solo cambia cómo se pinta; las filas salen igual que antes.
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { loadOrthoCases } from "@/lib/orthodontics/tablero-data";
import { ACTIVE_PLAN_STATUSES } from "@/lib/orthodontics/specialty-kpis";
import { OrthoPacientesTable, type OrthoPacienteRow } from "@/components/specialties/orthodontics/OrthoPacientesTable";
import { Pantalla } from "@/components/specialties/orthodontics/modulo/piezas";

export default async function OrthodonticsPacientesPage() {
  await exigirModuloOrtodoncia();
  const user = await getCurrentUser();
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };
  const { cases } = await loadOrthoCases(user.clinicId, user.clinic.timezone, viewer);

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
    <Pantalla
      titulo="Pacientes en tratamiento"
      sub={`${rows.length} caso${rows.length === 1 ? "" : "s"} activo${rows.length === 1 ? "" : "s"}.`}
    >
      <OrthoPacientesTable rows={rows} />
    </Pantalla>
  );
}
