// Periodontics — panel agregado del módulo. SPEC §6 + §11.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PERIODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { loadPeriodonticPatients } from "@/lib/periodontics/load-patients";
import { PeriodonticsSpecialtyClient } from "@/components/specialties/periodontics/PeriodonticsSpecialtyClient";

export default async function PeriodonticsIndexPage() {
  const user = await getCurrentUser();
  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  const access = await canAccessModule(user.clinicId, PERIODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${PERIODONTICS_MODULE_KEY}`);
  }

  // Visibilidad por paciente: viewer de sesión para filtrar los reads.
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };
  const data = await loadPeriodonticPatients(user.clinicId, viewer);

  const rowsSerializable = data.rows.map((r) => ({
    ...r,
    nextMaintenanceAt: r.nextMaintenanceAt ? r.nextMaintenanceAt.toISOString() : null,
  }));

  return (
    <PeriodonticsSpecialtyClient
      rows={rowsSerializable}
      kpis={data.kpis}
      doctors={data.doctors}
    />
  );
}
