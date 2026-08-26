import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit } from "@/lib/failban";
import {
  isStudioGateOk,
  openStudioGate,
  ownedProperty,
  studioServerError,
} from "../_server";
import { signRealtyUrls } from "@/lib/realty/media";
import {
  generateDescription,
  generateSocial,
  isTextOk,
  parseSocial,
  photosForVision,
  type StudioPropertyContext,
} from "@/lib/realty/studio/copy";
import {
  releaseStudioSpend,
  reserveStudioSpend,
  settleStudioSpend,
} from "@/lib/realty/studio/spend";
import { usdToMicros } from "@/lib/realty/studio/pricing";
import { REALTY_COPY_TONES, type RealtyCopyTone } from "@/lib/realty/studio/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * C y D: la descripción del anuncio y los textos para redes.
 *
 * Orden de las comprobaciones, y ninguna es opcional:
 *   puerta → límite de peticiones → inmueble de ESTA cuenta → RESERVA del
 *   gasto → llamada al modelo → se confirma con el costo real (o se libera
 *   si falló).
 */
export async function POST(req: NextRequest) {
  const gate = await openStudioGate();
  if (!isStudioGateOk(gate)) return gate.response;
  const { ctx } = gate;

  // Freno de gasto, no de DoS: la cuenta comparte IP, así que se limita por
  // CUENTA. Es la convención que ya usan /api/ai y /api/consult/ai-assist.
  const rl = await persistentRateLimit(req, {
    id: `realty-studio:${ctx.accountId}`,
    limit: 20,
    windowSec: 300,
    scope: "realty-studio",
  });
  if (rl) return rl;

  try {
    const body = await req.json().catch(() => ({}));
    const propertyId = typeof body?.propertyId === "string" ? body.propertyId : "";
    const wants = body?.kind === "social" ? "social" : "description";
    const tone: RealtyCopyTone = REALTY_COPY_TONES.includes(body?.tone)
      ? body.tone
      : "directo";

    if (!propertyId) {
      return NextResponse.json({ error: "Falta el inmueble.", code: "invalid" }, { status: 400 });
    }

    const p = await ownedProperty(ctx.accountId, propertyId);
    if (!p) {
      return NextResponse.json(
        { error: "Inmueble no encontrado.", code: "not_found" },
        { status: 404 },
      );
    }

    const precioNum = Number(p.operation === "RENTA" ? (p.rentPrice ?? p.price) : p.price);
    const property: StudioPropertyContext = {
      title: p.title,
      kind: String(p.kind),
      operation: String(p.operation),
      price: `$${precioNum.toLocaleString("es-MX", { maximumFractionDigits: 0 })} ${p.currency}`,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      parking: p.parking,
      builtM2: p.builtM2 == null ? null : Number(p.builtM2),
      landM2: p.landM2 == null ? null : Number(p.landM2),
      colonia: p.colonia,
      city: p.city,
      state: p.state,
      amenities: Object.entries((p.amenities as Record<string, boolean> | null) ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k),
      currentDescription: p.description,
    };

    // Las fotos que va a MIRAR el modelo. Viven en un bucket privado, así
    // que hay que firmarlas antes de bajarlas.
    //
    // 🔴 Se preparan ANTES de reservar el gasto. Si el bucket está lento o
    // una foto no baja, `photosForVision` devuelve una lista más corta y se
    // redacta con lo que haya — pero el minuto que tarde en descubrirlo no
    // debe transcurrir con presupuesto ya apartado: una reserva viva
    // mientras se bajan fotos es tope que otra pestaña no puede usar.
    const photos = await photosForVision(
      await signRealtyUrls(p.photos.map((f) => f.url)),
    );

    // Se RESERVA antes de llamar. El estimado es holgado; el cargo real se
    // corrige abajo con los tokens que devuelva el modelo.
    // El detalle que verá el asesor en el historial. Que diga si la IA MIRÓ
    // las fotos no es adorno: es la diferencia entre "me describió la casa"
    // y "me acomodó los datos que ya tenía capturados".
    const detalle = photos.length > 0 ? `${tone} · ${photos.length} fotos` : `${tone} · sin fotos`;

    const reservation = await reserveStudioSpend({
      accountId: ctx.accountId,
      timezone: ctx.account.timezone,
      kind: wants === "social" ? "social" : "description",
      // El estimado sube con las fotos porque el costo sube con las fotos:
      // cada imagen son ~790 tokens de entrada. Solo importa mientras la
      // reserva está viva —abajo se corrige con el gasto REAL—, pero es lo
      // que impide que diez pestañas a la vez reserven de menos y se pasen
      // del tope entre todas.
      estimatedMicros: usdToMicros(0.02 + photos.length * 0.008),
      propertyId: p.id,
      propertyTitle: p.title,
      detail: detalle,
    });
    if (!reservation) {
      return NextResponse.json(
        {
          error: "Llegaste a tu límite de IA de hoy. Mañana se reinicia.",
          code: "cap_reached",
        },
        { status: 429 },
      );
    }

    const outcome =
      wants === "social"
        ? await generateSocial({ property, tone, photos })
        : await generateDescription({ property, tone, photos });

    if (!isTextOk(outcome)) {
      // 🔴 Aquí se decide si el intento fallido se cobra, y la regla es
      // "se cobra lo que el proveedor nos cobró a nosotros":
      //
      //   · el modelo contestó y quemó tokens (una negativa, un corte por
      //     longitud) → `spentMicros` viene lleno y la reserva se CONFIRMA
      //     con ese número. Liberarla dejaría un bucle de negativas gratis
      //     para la cuenta y facturado para nosotros — un agujero en el tope
      //     que no necesita mala fe para abrirse;
      //   · no hubo llamada, o el proveedor devolvió un error HTTP → nadie
      //     cobró nada y la reserva se LIBERA, porque cobrarle a la cuenta
      //     un intento que no le dio nada es como se pierde a un cliente.
      if (outcome.spentMicros != null && outcome.spentMicros > 0) {
        await settleStudioSpend({
          reservation,
          actualMicros: outcome.spentMicros,
          detail: `${tone} · sin texto`,
        });
      } else {
        await releaseStudioSpend(reservation);
      }
      return NextResponse.json(
        { error: outcome.error.message, code: outcome.error.code },
        { status: outcome.error.code === "not_configured" ? 503 : 502 },
      );
    }

    await settleStudioSpend({
      reservation,
      actualMicros: outcome.call.micros,
      detail: detalle,
      model: outcome.call.model,
      inputTokens: outcome.call.inputTokens,
      outputTokens: outcome.call.outputTokens,
    });

    if (wants === "social") {
      return NextResponse.json({
        kind: "social",
        tone,
        result: parseSocial(outcome.call.text),
        micros: outcome.call.micros,
      });
    }

    return NextResponse.json({
      kind: "description",
      tone,
      result: { tone, text: outcome.call.text },
      micros: outcome.call.micros,
    });
  } catch (err) {
    return studioServerError("copy", err);
  }
}
