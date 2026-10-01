export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { WalkInClient } from "./walk-in-client";

export const metadata: Metadata = { title: "Fila de Espera — DaleControl" };

export default async function WalkInPage() {
  const user = await getCurrentUser();
  // Mismo permiso que la API (/api/walk-in): ver la fila = ver la agenda;
  // agregar = crear citas; avanzar/cancelar turnos = editar citas.
  requirePermissionOrRedirect(user, "agenda.view");
  const quien = { role: user.role, permissionsOverride: user.permissionsOverride ?? [] };
  const puedeAgregar = hasPermission(quien, "agenda.create");
  const puedeEditar = hasPermission(quien, "agenda.edit");
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

  return <WalkInClient key={clinicId} initialQueue={queue as any} rediseno={rediseno}
    puedeAgregar={puedeAgregar} puedeEditar={puedeEditar} />;
}
