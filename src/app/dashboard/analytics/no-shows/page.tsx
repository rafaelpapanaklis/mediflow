export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getServerT } from "@/i18n/server";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { NoShowsClient } from "./no-shows-client";

export const metadata: Metadata = { title: "No-shows — Analytics" };

export default async function NoShowsPage() {
  const user = await getCurrentUser();
  const { t } = await getServerT();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>{t("analytics.noShows.adminOnly")}</div>;
  }
  // REDISEÑO DE ANALÍTICA — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`).
  // El layout del panel ya lo resolvió en este mismo request y la respuesta
  // vive 60 s en memoria por clínica: aquí no hay viaje a la base. Falla
  // cerrado: apagado, la pantalla se pinta exactamente como hoy.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  return <NoShowsClient key={user.clinicId} rediseno={rediseno} />;
}
