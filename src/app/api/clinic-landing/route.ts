import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { validarCamposLanding } from "@/lib/landing-fields";

/**
 * El sitio público de la clínica.
 *
 * PERMISOS — este endpoint publica y DESPUBLICA (`landingActive`) la web que
 * ven los pacientes. Hasta la Ola 1 solo preguntaba si había sesión: cualquier
 * usuario de la clínica, incluido uno de SOLO LECTURA, podía reescribirla o
 * apagarla. Ahora exige `landing.edit`, que por default tienen el dueño
 * (SUPER_ADMIN) y los administradores.
 *
 * El clinicId sale SIEMPRE de la sesión (ctx.clinicId), jamás del body.
 */

export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(ctx, "landing.edit");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  // Lista literal + validador por campo (@/lib/landing-fields). Nada de armar
  // el cuerpo comparando objetos: ese patrón causó la fuga de 0424d5ab.
  const { data, invalidos } = validarCamposLanding(body);

  if (invalidos.length > 0) {
    // Nada a medias: o entra todo lo que mandó, o no entra nada. Guardar solo
    // lo válido dejaba a la clínica creyendo que publicó un cambio que no salió.
    return NextResponse.json(
      { error: `Estos campos no tienen el formato esperado: ${invalidos.join(", ")}` },
      { status: 400 },
    );
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const clinic = await prisma.clinic.update({
    where:  { id: ctx.clinicId },
    data,
    // Solo lo que hace falta para revalidar y contestar. Sin `select`, Prisma
    // devuelve la fila COMPLETA (RFC, ids de Stripe, SID de Twilio…) y bastaba
    // con olvidar un filtro para publicarla.
    select: { slug: true, updatedAt: true },
  });

  // /[slug] es ISR con revalidate 300: sin esto la clínica guardaba, iba a ver
  // su sitio, no veía el cambio y creía que se había perdido. Ahora la página
  // pública se regenera al guardar. Best-effort: si falla, el cambio YA está
  // en la base y a los 5 minutos se ve igual.
  try {
    revalidatePath(`/${clinic.slug}`);
    revalidatePath(`/landing-preview/${clinic.slug}`);
    revalidatePath(`/descubre/clinica/${clinic.slug}`);
  } catch (err) {
    console.error("[clinic-landing] revalidate falló:", err);
  }

  // Acuse de recibo, NO la clínica. El editor ya tiene en pantalla lo que
  // acaba de mandar; devolverle la fila solo servía para volver a exponer
  // columnas que no necesita (la lista negra de secretos dejaba pasar RFC,
  // stripeCustomerId y twilioAccountSid).
  return NextResponse.json({
    ok: true,
    updatedAt: clinic.updatedAt,
    fields: Object.keys(data),
  });
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = denyIfMissingPermission(ctx, "landing.view");
  if (denied) return denied;

  // `select` explícito por el mismo motivo que en /[slug]: esta fila salía
  // entera (menos 7 secretos de una lista negra) a cualquiera con sesión.
  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: {
      id: true, name: true, slug: true, phone: true, email: true, address: true, city: true,
      logoUrl: true, description: true,
      landingActive: true, landingTemplate: true, landingThemeColor: true,
      landingCoverUrl: true, landingGallery: true,
      landingTestimonials: true, landingFaqs: true, landingServices: true,
      landingWhatsapp: true, landingInstagram: true, landingFacebook: true,
      landingTiktok: true, landingMapEmbed: true, landingTagline: true,
      landingYearsExperience: true, landingPatients: true,
      landingSections: true, landingPhotos: true,
      landingUrgentText: true, landingMsiPlazos: true,
    },
  });
  return NextResponse.json(clinic);
}
