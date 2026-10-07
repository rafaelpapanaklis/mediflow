export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { direccionDeRebotePorRol } from "@/lib/auth/aviso-denegado";
import { resolverPeriodo } from "@/lib/sedes/reporte-consolidado-core";
import { accesoAlReporteDeSedes, hoyISOEn, reporteConsolidadoDeSedes } from "@/lib/sedes/reporte-consolidado.server";
import { ReporteSedesClient } from "./reporte-sedes-client";

export const metadata: Metadata = { title: "Reporte de sedes — DaleControl" };

/**
 * /dashboard/sedes/reporte — reporte consolidado de todas las sedes del dueño
 * (ws1-t10, auditoría BEVADENT · M6): ingresos, citas, pacientes nuevos,
 * no-shows, ocupación, ticket promedio y comparativa por sede, con periodo y
 * exportable a CSV.
 *
 * Solo el DUEÑO (SUPER_ADMIN) con plan que contempla sedes; el mismo guard se
 * repite en GET /api/sedes/reporte, que es de donde la pantalla recarga al
 * cambiar el periodo. El primer periodo («este mes») viene calculado del
 * servidor para no pintar la pantalla vacía.
 */
export default async function ReporteSedesPage() {
  const user = await getCurrentUser();
  const acceso = await accesoAlReporteDeSedes({ role: user.role, clinicId: user.clinicId });
  if (!acceso.ok) redirect(direccionDeRebotePorRol("dueno"));

  const { locale } = await getServerT();
  const hoy = hoyISOEn(acceso.timezone ?? "America/Mexico_City");
  const rango = resolverPeriodo("este-mes", hoy);
  const inicial = await reporteConsolidadoDeSedes({
    supabaseId: user.supabaseId,
    clinicIdActiva: user.clinicId,
    rango,
  });

  return <ReporteSedesClient key={user.clinicId} inicial={inicial} hoyISO={hoy} locale={locale} />;
}
