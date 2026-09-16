export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsClient } from "./settings-client";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { getServerT } from "@/i18n/server";
import { isFacturapiLive } from "@/lib/facturapi-env";
import { stripClinicSecrets } from "@/lib/clinic-secrets";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";

export const metadata: Metadata = { title: "Configuración — DaleControl" };

interface Props {
  searchParams: { tab?: string; gcal?: string };
}

export default async function SettingsPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "settings.view");
  const { t } = await getServerT();

  // "Mi clínica" — READONLY entra con settings.view pero no debe guardar
  // (ni el nombre, ni el logo). Se resuelve en el servidor: es la MISMA
  // llave que exige el PATCH (/api/clinic, /api/settings), no una nueva.
  const puedeEditarClinica = hasPermission(user, "settings.edit");

  // REDISEÑO DE CONFIGURACIÓN (ws1-t2) — el MISMO interruptor por clínica que
  // enciende el menú de dos niveles (`clinic_feature_flags`, bandera
  // `menu-dos-niveles`), no uno propio. Falla cerrado (sin tabla, sin fila o
  // con error → false = la pantalla de hoy, tal cual). Va en UN Promise.all
  // con las dos consultas que esta página ya hacía (antes en cascada, una
  // tras otra): ni un viaje más a la base, y la respuesta del interruptor
  // además vive 60 s en memoria por clínica.
  const [clinic, teamMembers, rediseno] = await Promise.all([
    prisma.clinic.findUnique({
      where:   { id: user.clinicId },
      include: { schedules: { orderBy: { dayOfWeek: "asc" } } },
    }),
    prisma.user.findMany({
      where:   { clinicId: user.clinicId, isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] } },
      select:  { id: true, firstName: true, lastName: true, role: true, services: true },
      orderBy: { firstName: "asc" },
    }),
    menuDosNivelesEncendido(user.clinicId),
  ]);

  // La fila COMPLETA de la clínica viaja al cliente (include, sin select): las
  // credenciales — Live Secret Key de Facturapi, tokens de WhatsApp/Twilio/
  // Google… — se sacan del payload antes de serializarlo al navegador.
  const clinicSafe = stripClinicSecrets((clinic ?? {}) as Record<string, any>);

  return (
    <ErrorBoundary fallbackTitle={t("settings.page.errorBoundaryTitle")}>
      <SettingsClient
        key={user.clinicId}
        user={user as any}
        clinic={clinicSafe as any}
        initialTab={searchParams.tab}
        gcalStatus={searchParams.gcal}
        cfdiLive={isFacturapiLive()}
        teamMembers={teamMembers as any}
        puedeEditarClinica={puedeEditarClinica}
        rediseno={rediseno}
      />
    </ErrorBoundary>
  );
}
