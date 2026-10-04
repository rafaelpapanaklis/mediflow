export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { CostsClient } from "./costs-client";
import { SinAcceso, TITULO_SIN_ACCESO } from "@/components/dashboard/sin-permiso-rediseno/sin-acceso";

export const metadata: Metadata = { title: "Costos y margen — Analítica" };

export default async function CostsAnalyticsPage() {
  const user = await getCurrentUser();
  const { t } = await getServerT();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    // C-109: el mismo «sin acceso» que el resto del panel.
    return <SinAcceso titulo={TITULO_SIN_ACCESO[(await getServerT()).locale.startsWith("en") ? "en" : "es"]} texto={t("analytics.costs.adminOnly")} volver={t("menuDosNiveles.cajaSinPermisoVolver")} />;
  }
  // REDISEÑO DE ANALÍTICA — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`).
  // El layout del panel ya lo resolvió en este mismo request y la respuesta
  // vive 60 s en memoria por clínica: aquí no hay viaje a la base. Falla
  // cerrado: apagado, la pantalla se pinta exactamente como hoy.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  return <CostsClient key={user.clinicId} rediseno={rediseno} />;
}
