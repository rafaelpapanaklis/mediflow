export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsClient } from "./settings-client";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { getServerT } from "@/i18n/server";
import { isFacturapiLive } from "@/lib/facturapi-env";
import { stripClinicSecrets } from "@/lib/clinic-secrets";

export const metadata: Metadata = { title: "Configuración — DaleControl" };

interface Props {
  searchParams: { tab?: string; gcal?: string };
}

export default async function SettingsPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "settings.view");
  const { t } = await getServerT();

  const clinic = await prisma.clinic.findUnique({
    where:   { id: user.clinicId },
    include: { schedules: { orderBy: { dayOfWeek: "asc" } } },
  });

  // La fila COMPLETA de la clínica viaja al cliente (include, sin select): las
  // credenciales — Live Secret Key de Facturapi, tokens de WhatsApp/Twilio/
  // Google… — se sacan del payload antes de serializarlo al navegador.
  const clinicSafe = stripClinicSecrets((clinic ?? {}) as Record<string, any>);

  const teamMembers = await prisma.user.findMany({
    where:   { clinicId: user.clinicId, isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] } },
    select:  { id: true, firstName: true, lastName: true, role: true, services: true },
    orderBy: { firstName: "asc" },
  });

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
      />
    </ErrorBoundary>
  );
}
