export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LandingConfigClient } from "./landing-config-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { stripClinicSecrets } from "@/lib/clinic-secrets";
import { getAccountManagerForClinic } from "@/lib/account-manager/get-for-clinic";
import { localeFromClinic } from "@/i18n/server";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";

export default async function LandingConfigPage() {
  const user   = await getCurrentUser();
  requirePermissionOrRedirect(user, "landing.view");
  // REDISEÑO DE PÁGINA WEB — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles (no uno propio: Rafael prueba «el diseño nuevo» como
  // una sola cosa). Va en el mismo Promise.all que la consulta de la clínica
  // para no añadir un viaje a la base aparte, y su respuesta vive 60 s en
  // memoria por clínica (ver src/lib/menu-dos-niveles/interruptor-core.ts):
  // no es una consulta nueva por carga, es la misma que ya pagan Pacientes,
  // Agenda y Hoy. Falla cerrado (sin tabla, sin fila o con error → false =
  // la pantalla de hoy, tal cual).
  const [clinic, rediseno] = await Promise.all([
    prisma.clinic.findUnique({
      where:   { id: user.clinicId },
      include: { schedules: { orderBy: { dayOfWeek: "asc" } } },
    }),
    menuDosNivelesEncendido(user.clinicId),
  ]);
  // Manager de cuenta para el banner del pie ("¿necesitas una página más
  // avanzada?"). Mismo helper y mismo patrón que /dashboard/soporte: el
  // clinicId sale de la SESIÓN, la disponibilidad se evalúa en la timezone del
  // manager (no en la del navegador) y al cliente viaja SÓLO el manager
  // asignado a esta clínica, nunca el catálogo.
  //
  // Nunca lanza: sin manager asignado devuelve null y el banner cambia de
  // destino (soporte) en vez de romperse. Ver landing-upgrade-banner.tsx.
  const accountManager = await getAccountManagerForClinic(user.clinicId, {
    locale: localeFromClinic(user.clinic),
  });
  // Ver ≠ editar: "landing.view" lo tiene hasta un usuario de SOLO LECTURA
  // (todas las keys *.view entran en su default). Quien no tiene "landing.edit"
  // ve su sitio pero no puede tocarlo — y se lo decimos en pantalla en vez de
  // dejar que descubra el 403 del endpoint al pulsar Guardar.
  const puedeEditar = hasPermission(user, "landing.edit");
  // La fila COMPLETA viaja a un componente cliente: se filtran las credenciales
  // (Live Secret Key de Facturapi, tokens de WhatsApp/Twilio/Google…) para que no
  // terminen en el payload RSC. "landing.view" no es un permiso solo de admin.
  // `updatedAt` como ISO string (mismo patrón que /dashboard/landing/editor/page.tsx):
  // es la marca con la que carga esta pantalla, y save() la manda de vuelta como
  // `esperadoUpdatedAt` para que el servidor detecte si otra pestaña guardó antes.
  const clinicPayload = {
    ...stripClinicSecrets(clinic),
    updatedAt: clinic?.updatedAt ? clinic.updatedAt.toISOString() : new Date().toISOString(),
  };
  return <LandingConfigClient key={user.clinicId} clinic={clinicPayload as any} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} puedeEditar={puedeEditar} accountManager={accountManager} clinicName={clinic?.name ?? ""} rediseno={rediseno} />;
}
