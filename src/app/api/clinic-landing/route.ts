import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { validarCamposLanding } from "@/lib/landing-fields";
import {
  guardarSinPisar,
  type AlmacenDeClinica,
  type FilaDeGuardia,
} from "@/lib/landing-concurrency";

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

  /* ── CONCURRENCIA ────────────────────────────────────────────
     El editor visual y el formulario de siempre están vivos a la vez, a
     propósito, así que hace falta control de concurrencia de verdad. La regla
     está entera en @/lib/landing-concurrency, con el porqué; aquí solo se lee
     lo que manda el cliente y se enchufa Prisma.

     Dos datos, y los dos son del cliente:
       esperadoUpdatedAt · la marca de la fila cuando cargó la pantalla.
       base              · lo que esa pantalla tenía por PUBLICADO en las
                           MISMAS columnas que ahora escribe. Es lo que permite
                           distinguir "me pisaron" de "la fila se movió por el
                           webhook de Stripe" — el segundo caso disparaba un
                           409 falso y dejaba el editor inservible.
     `base` NO se escribe nunca: solo se compara. */
  const cuerpo = (body ?? {}) as Record<string, unknown>;

  const esperado = typeof cuerpo.esperadoUpdatedAt === "string"
    ? new Date(cuerpo.esperadoUpdatedAt)
    : null;
  if (esperado && Number.isNaN(esperado.getTime())) {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const base = (() => {
    const b = cuerpo.base;
    if (!b || typeof b !== "object" || Array.isArray(b)) return null;
    const solo: Record<string, unknown> = {};
    for (const campo of Object.keys(data)) solo[campo] = (b as Record<string, unknown>)[campo] ?? null;
    return solo;
  })();

  let slug: string | null = null;

  const almacen: AlmacenDeClinica = {
    async actualizarSi(marca, d) {
      // updateMany y no update: `update` solo acepta claves únicas en el where,
      // y comprobar antes con un findUnique dejaría una rendija entre la lectura
      // y la escritura. La ventana es de UN milisegundo porque la columna guarda
      // microsegundos y un Date de JavaScript no llega ahí.
      const r = await prisma.clinic.updateMany({
        where: { id: ctx.clinicId, updatedAt: { gte: marca.gte, lt: marca.lt } },
        data: d,
      });
      return r.count;
    },
    async actualizar(d) {
      // Sin `select`, Prisma devuelve la fila COMPLETA (RFC, ids de Stripe, SID
      // de Twilio…) y bastaba con olvidar un filtro para publicarla.
      const c = await prisma.clinic.update({
        where: { id: ctx.clinicId },
        data: d,
        select: { slug: true, updatedAt: true },
      }).catch(() => null);
      if (!c) return null;
      slug = c.slug;
      return c.updatedAt;
    },
    async leer(columnas) {
      // Solo lo que hace falta: la marca, el slug para revalidar y las columnas
      // que se están escribiendo. Nunca la fila.
      const select: Record<string, boolean> = { updatedAt: true, slug: true };
      for (const c of columnas) select[c] = true;
      const fila = await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select }) as
        Record<string, unknown> | null;
      if (!fila) return null;
      if (typeof fila.slug === "string") slug = fila.slug;
      return fila as unknown as FilaDeGuardia;
    },
  };

  const resultado = await guardarSinPisar(almacen, {
    data,
    esperado,
    base,
    alFallarLaGuardia({ esperado: e, actual, campos }) {
      // El rastro que faltaba cuando esto disparaba en falso: las dos marcas
      // y si el contenido se movió de verdad. Sin esto no había forma de saber
      // desde fuera si el 409 era real.
      console.warn("[clinic-landing] guardia no entró:", JSON.stringify({
        clinicId: ctx.clinicId,
        esperado: e.toISOString(),
        actual: actual ? actual.toISOString() : null,
        campos,
        conBase: base !== null,
      }));
    },
  });

  if (resultado.estado === "sin-fila") {
    return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
  }

  if (resultado.estado === "conflicto") {
    // Se devuelven SOLO las columnas en conflicto, y salen de la misma lista
    // literal que ya se validó: nada de la fila entera. Con esto la pantalla
    // puede ofrecer algo mejor que "recarga y pierde lo que escribiste".
    return NextResponse.json(
      {
        error: "Tu página cambió en otra pestaña desde que abriste esta.",
        conflicto: true,
        campos: resultado.campos,
        actual: resultado.actual,
        updatedAt: resultado.updatedAt,
      },
      { status: 409 },
    );
  }

  // /[slug] es ISR con revalidate 300: sin esto la clínica guardaba, iba a ver
  // su sitio, no veía el cambio y creía que se había perdido. Ahora la página
  // pública se regenera al guardar. Best-effort: si falla, el cambio YA está
  // en la base y a los 5 minutos se ve igual.
  if (slug) {
    try {
      revalidatePath(`/${slug}`);
      revalidatePath(`/landing-preview/${slug}`);
      revalidatePath(`/descubre/clinica/${slug}`);
    } catch (err) {
      console.error("[clinic-landing] revalidate falló:", err);
    }
  }

  // Acuse de recibo, NO la clínica. El editor ya tiene en pantalla lo que
  // acaba de mandar; devolverle la fila solo servía para volver a exponer
  // columnas que no necesita (la lista negra de secretos dejaba pasar RFC,
  // stripeCustomerId y twilioAccountSid).
  return NextResponse.json({
    ok: true,
    updatedAt: resultado.updatedAt,
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
