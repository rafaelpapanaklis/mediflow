export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LandingConfigClient } from "./landing-config-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { stripClinicSecrets } from "@/lib/clinic-secrets";

export default async function LandingConfigPage() {
  const user   = await getCurrentUser();
  requirePermissionOrRedirect(user, "landing.view");
  const clinic = await prisma.clinic.findUnique({
    where:   { id: user.clinicId },
    include: { schedules: { orderBy: { dayOfWeek: "asc" } } },
  });
  // La fila COMPLETA viaja a un componente cliente: se filtran las credenciales
  // (Live Secret Key de Facturapi, tokens de WhatsApp/Twilio/Google…) para que no
  // terminen en el payload RSC. "landing.view" no es un permiso solo de admin.
  return <LandingConfigClient key={user.clinicId} clinic={stripClinicSecrets(clinic) as any} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} />;
}
