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

  /* CONCURRENCIA — el editor visual y el formulario de siempre son dos
     superficies vivas a la vez, y a propósito. Quien manda `esperadoUpdatedAt`
     dice "guardo sobre la versión que cargué"; si la fila se movió mientras
     tanto, no se pisa: 409 y que la pantalla decida. Se hace con updateMany
     porque `update` solo acepta claves únicas en el where, y comprobar antes
     con un findUnique dejaría una rendija entre la lectura y la escritura. */
  const esperado = typeof (body as Record<string, unknown>)?.esperadoUpdatedAt === "string"
    ? new Date((body as Record<string, string>).esperadoUpdatedAt)
    : null;
  if (esperado && Number.isNaN(esperado.getTime())) {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (esperado) {
    const tocadas = await prisma.clinic.updateMany({
      where: { id: ctx.clinicId, updatedAt: esperado },
      data,
    });
    if (tocadas.count === 0) {
      // Se devuelven SOLO los campos que se intentaban guardar, y salen de la
      // misma lista literal que ya se validó: nada de la fila entera.
      const select: Record<string, boolean> = { updatedAt: true };
      for (const campo of Object.keys(data)) select[campo] = true;
      const actual = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select });
      return NextResponse.json(
        { error: "Tu página cambió en otra pestaña desde que abriste esta.", conflicto: true, actual },
        { status: 409 },
      );
    }
  }

  const clinic = esperado
    ? await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { slug: true, updatedAt: true } })
    : await prisma.clinic.update({
        where:  { id: ctx.clinicId },
        data,
        // Solo lo que hace falta para revalidar y contestar. Sin `select`, Prisma
        // devuelve la fila COMPLETA (RFC, ids de Stripe, SID de Twilio…) y bastaba
        // con olvidar un filtro para publicarla.
        select: { slug: true, updatedAt: true },
      });

  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

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
