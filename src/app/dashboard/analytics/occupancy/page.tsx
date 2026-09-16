export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TREATMENT_KINDS } from "@/lib/agenda/types";
import { OccupancyClient } from "./occupancy-client";
import { getServerT } from "@/i18n/server";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";

export const metadata: Metadata = { title: "Ocupación — Analytics" };

export default async function OccupancyPage() {
  const user = await getCurrentUser();
  const { t } = await getServerT();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return <div style={{ padding: 32, color: "var(--text-3)" }}>{t("analytics.occupancyPage.adminOnly")}</div>;
  }

  // REDISEÑO DE ANALÍTICA — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`).
  // El layout del panel ya lo resolvió en este mismo request y la respuesta
  // vive 60 s en memoria por clínica: aquí no hay viaje a la base. Falla
  // cerrado: apagado, la pantalla se pinta exactamente como hoy.
  const [resources, doctors, rediseno] = await Promise.all([
    prisma.resource.findMany({
      where: { clinicId: user.clinicId, isActive: true, kind: { in: [...TREATMENT_KINDS] } },
      select: { id: true, name: true },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: { clinicId: user.clinicId, isActive: true, role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
    menuDosNivelesEncendido(user.clinicId),
  ]);

  return <OccupancyClient key={user.clinicId} resources={resources} doctors={doctors} rediseno={rediseno} />;
}
