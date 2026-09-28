// Ortodoncia — Pacientes en tratamiento (ws1-t2, Ola 1). La lista de casos
// activos, con su fase y su cobranza real (factura del tratamiento, decisión
// 1 de la arquitectura). La guarda de módulo corre en el layout y, otra vez, aquí.
//
// Diseño (ws1-t3): solo cambia cómo se pinta; las filas salen igual que antes.
//
// 28-sep-2026 (ws1-t3, H17 de la QA en vivo): botón «Abrir caso», que lleva a
// elegir paciente. Antes un caso solo se abría desde la ficha. Lo ve quien
// puede escribir en el expediente (`medicalRecord.edit`), el mismo permiso
// que exige crear el caso.
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { loadOrthoCases } from "@/lib/orthodontics/tablero-data";
import { ACTIVE_PLAN_STATUSES } from "@/lib/orthodontics/specialty-kpis";
import { OrthoPacientesTable, type OrthoPacienteRow } from "@/components/specialties/orthodontics/OrthoPacientesTable";
import { Pantalla } from "@/components/specialties/orthodontics/modulo/piezas";
import { AbrirCasoBoton } from "@/components/specialties/orthodontics/modulo/abrir-caso";

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

  const puedeAbrirCaso = hasPermission(
    { role: user.role, permissionsOverride: user.permissionsOverride },
    "medicalRecord.edit",
  );

  return (
    <Pantalla
      titulo="Pacientes en tratamiento"
      sub={`${rows.length} caso${rows.length === 1 ? "" : "s"} activo${rows.length === 1 ? "" : "s"}.`}
      acciones={puedeAbrirCaso ? <AbrirCasoBoton /> : undefined}
    >
      <OrthoPacientesTable rows={rows} puedeAbrirCaso={puedeAbrirCaso} />
    </Pantalla>
  );
}
