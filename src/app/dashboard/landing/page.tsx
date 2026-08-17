export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LandingConfigClient } from "./landing-config-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { stripClinicSecrets } from "@/lib/clinic-secrets";

export default async function LandingConfigPage() {
  const user   = await getCurrentUser();
  requirePermissionOrRedirect(user, "landing.view");
  const clinic = await prisma.clinic.findUnique({
    where:   { id: user.clinicId },
    include: { schedules: { orderBy: { dayOfWeek: "asc" } } },
  });
  // Ver ≠ editar: "landing.view" lo tiene hasta un usuario de SOLO LECTURA
  // (todas las keys *.view entran en su default). Quien no tiene "landing.edit"
  // ve su sitio pero no puede tocarlo — y se lo decimos en pantalla en vez de
  // dejar que descubra el 403 del endpoint al pulsar Guardar.
  const puedeEditar = hasPermission(user, "landing.edit");
  // La fila COMPLETA viaja a un componente cliente: se filtran las credenciales
  // (Live Secret Key de Facturapi, tokens de WhatsApp/Twilio/Google…) para que no
  // terminen en el payload RSC. "landing.view" no es un permiso solo de admin.
  return <LandingConfigClient key={user.clinicId} clinic={stripClinicSecrets(clinic) as any} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} puedeEditar={puedeEditar} />;
}
