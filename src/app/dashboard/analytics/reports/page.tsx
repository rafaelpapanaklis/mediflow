export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { getServerT } from "@/i18n/server";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { cargarReportes } from "../../reports/cargar-reportes";
import { ReportsRediseno } from "./reports-rediseno";

export const metadata: Metadata = { title: "Reportes — Analytics" };

/**
 * La pestaña Reportes de Analítica. Solo existe con el interruptor
 * `menu-dos-niveles` encendido: apagado, esta URL lleva a los Reportes de
 * siempre (`/dashboard/reports`), que siguen vivos y sin tocar.
 *
 * Mismo permiso que Reportes (`reports.view`) y los MISMOS datos: los carga
 * `cargarReportes`, la única fuente de las dos pantallas. El plan lo cierra el
 * layout de `/dashboard/analytics`, como al resto de las pestañas.
 */
export default async function AnalyticsReportsPage() {
  const { t } = await getServerT();
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "reports.view");

  // El layout del panel ya resolvió el interruptor en este request (60 s en
  // memoria por clínica): preguntarlo antes no cuesta un viaje a la base y
  // evita calcular los reportes para luego redirigir.
  if (!(await menuDosNivelesEncendido(user.clinicId))) redirect("/dashboard/reports");

  const { monthlyData, topTypes, byStatus, patientStats, clinicStats } = await cargarReportes(user.clinicId, t);

  return (
    <ReportsRediseno
      key={user.clinicId}
      monthlyData={monthlyData}
      topTypes={topTypes}
      byStatus={byStatus}
      patientStats={patientStats}
      clinicStats={clinicStats}
    />
  );
}
