// Pediatrics — panel agregado del módulo de Odontopediatría. Spec §7.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PEDIATRICS_MODULE_KEY } from "@/lib/pediatrics/permissions";
import { loadPediatricPatients } from "@/lib/pediatrics/load-patients";
import { PediatricsSpecialtyClient } from "@/components/specialties/pediatrics/PediatricsSpecialtyClient";

export default async function PediatricsIndexPage() {
  const user = await getCurrentUser();

  if (user.clinic.category !== "DENTAL" && user.clinic.category !== "MEDICINE") {
    redirect("/dashboard");
  }

  const access = await canAccessModule(user.clinicId, PEDIATRICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${PEDIATRICS_MODULE_KEY}`);
  }

  const data = await loadPediatricPatients(user.clinicId);

  const rowsSerializable = data.rows.map((r) => ({
    ...r,
    nextAppointmentAt: r.nextAppointmentAt ? r.nextAppointmentAt.toISOString() : null,
  }));

  return <PediatricsSpecialtyClient rows={rowsSerializable} kpis={data.kpis} />;
}
