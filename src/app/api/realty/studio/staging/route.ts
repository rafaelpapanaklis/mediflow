import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import { validateMagicNumber } from "@/lib/validate-upload";
import {
  REALTY_MAX_PHOTO_BYTES,
  REALTY_PHOTO_MIME,
  addRealtyStorageBytes,
  assertRealtyStorageRoom,
  imageDimensions,
  signRealtyUrl,
  uploadRealtyFile,
} from "@/lib/realty/media";
import { isStudioGateOk, openStudioGate, studioServerError } from "../_server";
import { generateStaging, isStagingOk } from "@/lib/realty/studio/staging";
import {
  releaseStudioSpend,
  reserveStudioSpend,
  settleStudioSpend,
} from "@/lib/realty/studio/spend";
import { STAGING_IMAGE_MICROS } from "@/lib/realty/studio/pricing";
import {
  REALTY_AI_PHOTO_PREFIX,
  REALTY_STAGING_STYLES,
  type RealtyStagingStyle,
} from "@/lib/realty/studio/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Generar la imagen tarda; el timeout del proveedor es de 120 s.
export const maxDuration = 300;

/**
 * B. Home staging virtual.
 *
 * 🔴 La foto generada entra como una foto MÁS del inmueble. La original no
 * se toca, no se reemplaza y no se borra: se queda donde estaba, con su
 * mismo id. Y la nueva sale con la marca "IMAGEN ILUSTRATIVA" QUEMADA en
 * los píxeles (lo hace generateStaging, que es el único camino por el que
 * puede nacer este buffer).
 */
export async function POST(req: NextRequest) {
  const gate = await openStudioGate();
  if (!isStudioGateOk(gate)) return gate.response;
  const { ctx } = gate;

  // Más apretado que el texto: cada imagen cuesta ~25 veces más.
  const rl = await persistentRateLimit(req, {
    id: `realty-staging:${ctx.accountId}`,
    limit: 6,
    windowSec: 600,
    scope: "realty-staging",
  });
  if (rl) return rl;

  try {
    const form = await req.formData();
    const propertyId = String(form.get("propertyId") ?? "");
    const rawStyle = String(form.get("style") ?? "moderno");
    const style: RealtyStagingStyle = REALTY_STAGING_STYLES.includes(
      rawStyle as RealtyStagingStyle,
    )
      ? (rawStyle as RealtyStagingStyle)
      : "moderno";
    const file = form.get("file");

    if (!propertyId || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Falta el inmueble o la foto.", code: "invalid" },
        { status: 400 },
      );
    }

    const property = await prisma.realtyProperty.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
      select: { id: true, title: true },
    });
    if (!property) {
      return NextResponse.json(
        { error: "Inmueble no encontrado.", code: "not_found" },
        { status: 404 },
      );
    }

    // Las mismas tres capas que la subida normal de fotos: tipo declarado,
    // tamaño y número mágico. El tipo que manda el navegador se puede mentir.
    if (!REALTY_PHOTO_MIME.includes(file.type)) {
      return NextResponse.json(
        { error: "Solo JPG, PNG o WebP.", code: "invalid" },
        { status: 400 },
      );
    }
    if (file.size > REALTY_MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "La foto pesa de más.", code: "invalid" }, { status: 400 });
    }
    const raw = await file.arrayBuffer();
    // Devuelve el MOTIVO (string) o null si está bien — no un booleano.
    const magicError = await validateMagicNumber(raw, REALTY_PHOTO_MIME);
    if (magicError) {
      return NextResponse.json({ error: magicError, code: "invalid" }, { status: 400 });
    }
    const bytes = Buffer.from(raw);

    // Hay cupo de almacenamiento ANTES de gastar en la IA: quedarse sin
    // espacio DESPUÉS de pagar la imagen sería cobrarle a la cuenta por nada.
    await assertRealtyStorageRoom(ctx.accountId, ctx.plan.storageQuotaMb, bytes.length);

    const reservation = await reserveStudioSpend({
      accountId: ctx.accountId,
      timezone: ctx.account.timezone,
      kind: "staging",
      estimatedMicros: STAGING_IMAGE_MICROS,
      propertyId: property.id,
      propertyTitle: property.title,
      detail: style,
    });
    if (!reservation) {
      return NextResponse.json(
        { error: "Llegaste a tu límite de IA de hoy. Mañana se reinicia.", code: "cap_reached" },
        { status: 429 },
      );
    }

    const out = await generateStaging({ photo: bytes, photoMime: file.type, style });
    if (!isStagingOk(out)) {
      await releaseStudioSpend(reservation);
      return NextResponse.json(
        { error: out.error.message, code: out.error.code },
        { status: out.error.code === "not_configured" ? 503 : 502 },
      );
    }

    // La imagen ya se pagó: el cargo se confirma aunque el guardado falle.
    // El precio por imagen no viene en la respuesta del proveedor, así que
    // se queda el estimado (ver STAGING_IMAGE_MICROS).
    await settleStudioSpend({ reservation, detail: style });

    const dims = await imageDimensions(out.buffer);
    // Ruta con marca `ia-` en el nombre: es el ÚNICO rastro disponible para
    // reconocer una foto generada, porque RealtyPropertyPhoto no tiene
    // ninguna columna libre y el schema no se toca en esta ola.
    const path = `${ctx.accountId}/${property.id}/fotos/${REALTY_AI_PHOTO_PREFIX}${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}.jpg`;
    await uploadRealtyFile(path, out.buffer, out.contentType);

    const count = await prisma.realtyPropertyPhoto.count({
      where: { accountId: ctx.accountId, propertyId: property.id },
    });
    const photo = await prisma.realtyPropertyPhoto.create({
      data: {
        accountId: ctx.accountId,
        propertyId: property.id,
        url: path,
        width: dims.width,
        height: dims.height,
        bytes: out.buffer.length,
        sortOrder: count,
        // 🔴 NUNCA portada. Una imagen generada no puede ser la cara del
        // anuncio, aunque sea la primera foto que se sube.
        isCover: false,
        watermarked: true,
      },
      select: { id: true },
    });
    await addRealtyStorageBytes(ctx.accountId, out.buffer.length);

    return NextResponse.json({
      photoId: photo.id,
      url: await signRealtyUrl(path),
      style,
      micros: STAGING_IMAGE_MICROS,
    });
  } catch (err) {
    // Sin cupo de almacenamiento llega como RealtyStorageFullError.
    if ((err as { name?: string })?.name === "RealtyStorageFullError") {
      return NextResponse.json(
        { error: "Ya no tienes espacio de almacenamiento.", code: "invalid" },
        { status: 413 },
      );
    }
    return studioServerError("staging", err);
  }
}
