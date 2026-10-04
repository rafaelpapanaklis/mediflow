export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { ProceduresClient } from "./procedures-client";
import { SinAcceso, TITULO_SIN_ACCESO } from "@/components/dashboard/sin-permiso-rediseno/sin-acceso";

export const metadata: Metadata = { title: "Procedimientos — Analytics" };

export default async function ProceduresPage() {
  const { t } = await getServerT();
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    // C-109: el mismo «sin acceso» que el resto del panel.
    return <SinAcceso titulo={TITULO_SIN_ACCESO[(await getServerT()).locale.startsWith("en") ? "en" : "es"]} texto={t("analytics.proceduresPage.adminOnly")} volver={t("menuDosNiveles.cajaSinPermisoVolver")} />;
  }
  // REDISEÑO DE ANALÍTICA — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`).
  // El layout del panel ya lo resolvió en este mismo request y la respuesta
  // vive 60 s en memoria por clínica: aquí no hay viaje a la base. Falla
  // cerrado: apagado, la pantalla se pinta exactamente como hoy.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  return <ProceduresClient key={user.clinicId} rediseno={rediseno} />;
}
