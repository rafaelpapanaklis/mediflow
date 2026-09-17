export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { ReportsClient } from "./reports-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { getServerT } from "@/i18n/server";
import { cargarReportes } from "./cargar-reportes";

export const metadata: Metadata = { title: "Reportes — DaleControl" };

export default async function ReportsPage() {
  const { t }     = await getServerT();
  const user      = await getCurrentUser();
  requirePermissionOrRedirect(user, "reports.view");
  const clinicId  = user.clinicId;
  // El cálculo vive en `cargar-reportes.ts` (movido tal cual, ni una consulta
  // ni una cuenta cambiada) porque también lo lee la pestaña Reportes de
  // Analítica. Esta pantalla sigue viva para quien llegue por la URL de siempre.
  const { monthlyData, topTypes, byStatus, patientStats, clinicStats, rediseno } =
    await cargarReportes(clinicId, t);

  return (
    <ReportsClient
      monthlyData={monthlyData}
      topTypes={topTypes}
      byStatus={byStatus}
      patientStats={patientStats}
      clinicStats={clinicStats}
      rediseno={rediseno}
    />
  );
}
