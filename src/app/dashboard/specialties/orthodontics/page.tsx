// Orthodontics — panel agregado del módulo. SPEC §6.2.
// KPIs + tabla + toggle Tabla/Kanban + modal de búsqueda de paciente.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { buildKanbanData } from "@/lib/orthodontics/build-kanban-data";
import { loadOrthodonticPatients } from "@/lib/orthodontics/load-patients";
import { OrthodonticsSpecialtyClient } from "@/components/specialties/orthodontics/OrthodonticsSpecialtyClient";

export default async function OrthodonticsIndexPage() {
  const user = await getCurrentUser();
  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  const access = await canAccessModule(user.clinicId, ORTHODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${ORTHODONTICS_MODULE_KEY}`);
  }

  const [data, kanbanCards] = await Promise.all([
    loadOrthodonticPatients(user.clinicId),
    buildKanbanData(user.clinicId),
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
