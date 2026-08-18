export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { EditorVisual } from "./editor-client";

/**
 * EL LIENZO: la mini-web de la clínica, editable haciendo clic encima.
 *
 * PERMISO — "landing.edit", no "landing.view". Un usuario de solo lectura
 * hereda todas las keys *.view por el filtro de permissions.ts, así que con
 * "landing.view" abriría el editor y descubriría el 403 veinte minutos
 * después, al pulsar Guardar. El gate del PATCH y el de /landing-preview
 * exigen lo mismo: ocultar el botón nunca fue el gate.
 *
 * SELECT EXPLÍCITO — esta fila viaja a un componente cliente. Con `include`
 * o con la fila entera se van waAccessToken, facturApiLiveKey, twilioAuthToken
 * y el RFC dentro del payload RSC; eso ya pasó una vez (commit 0424d5ab).
 * Enumerar es a prueba de futuro: una columna secreta nueva no se filtra
 * sola, sencillamente no se pide.
 *
 * La lista es exactamente lo que el lienzo edita (las columnas de
 * @/lib/landing-address) más lo que necesita para dibujarse.
 */
export default async function EditorVisualPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "landing.edit");

  const clinic = await prisma.clinic.findUnique({
    where: { id: user.clinicId },
    select: {
      slug: true, name: true, updatedAt: true,
      landingActive: true, landingTemplate: true, landingThemeColor: true,
      phone: true, address: true, description: true,
      landingTagline: true, landingPatients: true, landingUrgentText: true,
      landingSections: true, landingServices: true, landingFaqs: true,
      landingTestimonials: true, landingPhotos: true,
    },
  });
  if (!clinic) redirect("/dashboard/landing");

  return (
    <EditorVisual
      inicial={{
        slug: clinic.slug,
        name: clinic.name,
        updatedAt: clinic.updatedAt.toISOString(),
        landingActive: clinic.landingActive,
        landingTemplate: clinic.landingTemplate,
        landingThemeColor: clinic.landingThemeColor,
        phone: clinic.phone,
        address: clinic.address,
        description: clinic.description,
        landingTagline: clinic.landingTagline,
        landingPatients: clinic.landingPatients,
        landingUrgentText: clinic.landingUrgentText,
        landingSections: clinic.landingSections ?? null,
        landingServices: clinic.landingServices ?? null,
        landingFaqs: clinic.landingFaqs ?? null,
        landingTestimonials: clinic.landingTestimonials ?? null,
        landingPhotos: clinic.landingPhotos ?? null,
      }}
    />
  );
}
