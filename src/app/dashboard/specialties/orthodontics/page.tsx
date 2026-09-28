// Orthodontics — panel agregado del módulo. SPEC §6.2.
// KPIs + tabla + toggle Tabla/Kanban + modal de búsqueda de paciente.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { hasPermission } from "@/lib/auth/permissions";
import { buildKanbanData } from "@/lib/orthodontics/build-kanban-data";
import { loadOrthodonticPatients } from "@/lib/orthodontics/load-patients";
import { OrthodonticsSpecialtyClient } from "@/components/specialties/orthodontics/OrthodonticsSpecialtyClient";

export default async function OrthodonticsIndexPage() {
  const user = await getCurrentUser();
  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  // Ola 1 (A1, ws1-t3): guarda REAL (ClinicModule activo), no el atajo de
  // trial de canAccessModule/evaluateAccess — ver src/lib/orthodontics/access.ts.
  // Más "specialties.orthodontics" (P3): sin el permiso, tampoco entra por URL.
  const active = await hasActiveOrthodonticsModule(user.clinicId);
  if (!active || !hasPermission({ role: user.role, permissionsOverride: user.permissionsOverride }, "specialties.orthodontics")) {
    redirect("/dashboard");
  }

  // Visibilidad por paciente: viewer de sesión para filtrar los reads.
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };

  const [data, kanbanCards] = await Promise.all([
    loadOrthodonticPatients(user.clinicId, viewer),
    buildKanbanData(user.clinicId, viewer),
  ]);

  const rowsSerializable = data.rows.map((r) => ({
    ...r,
    nextAppointmentAt: r.nextAppointmentAt ? r.nextAppointmentAt.toISOString() : null,
  }));

  return (
    <OrthodonticsSpecialtyClient
      rows={rowsSerializable}
      kpis={data.kpis}
      doctors={data.doctors}
      kanbanCards={kanbanCards}
    />
  );
}
