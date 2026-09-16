export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { WalkInClient } from "./walk-in-client";

export const metadata: Metadata = { title: "Fila de Espera — DaleControl" };

export default async function WalkInPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // REDISEÑO — el MISMO interruptor por clínica que enciende el menú de dos
  // niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno
  // propio. Falla cerrado (→ false = la pantalla de hoy, tal cual). Va en el
  // mismo Promise.all que la fila para no añadir un viaje a la base; la
  // respuesta además vive 60 s en memoria por clínica.
  const [queue, rediseno] = await Promise.all([
    prisma.walkInQueue.findMany({
      where: {
        clinicId,
        joinedAt: { gte: today, lt: tomorrow },
      },
      orderBy: [{ priority: "desc" }, { joinedAt: "asc" }],
    }),
    menuDosNivelesEncendido(clinicId),
  ]);

  return <WalkInClient key={clinicId} initialQueue={queue as any} rediseno={rediseno} />;
}
