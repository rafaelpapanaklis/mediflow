export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { leerPantallaAnticipos } from "@/lib/anticipos/pantalla.server";
import { AnticiposClient } from "./anticipos-client";

export const metadata: Metadata = { title: "Anticipos por WhatsApp — DaleControl" };

/**
 * /dashboard/settings/anticipos — WS1-T5.
 *
 * Conectar la cuenta de Mercado Pago de la clínica y decidir si el bot de
 * WhatsApp pide anticipo al agendar. Mismo permiso que las integraciones
 * (settings.edit); la API lo vuelve a exigir.
 */
export default async function AnticiposPage({
  searchParams,
}: {
  searchParams?: { mp?: string; motivo?: string };
}) {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "settings.edit");

  const [pantalla, clinica] = await Promise.all([
    leerPantallaAnticipos(user.clinicId),
    prisma.clinic.findUnique({ where: { id: user.clinicId }, select: { timezone: true } }),
  ]);

  return (
    <AnticiposClient
      key={user.clinicId}
      inicial={pantalla}
      timezone={clinica?.timezone ?? "America/Mexico_City"}
      resultado={searchParams?.mp ?? null}
      motivo={searchParams?.motivo ?? null}
    />
  );
}
