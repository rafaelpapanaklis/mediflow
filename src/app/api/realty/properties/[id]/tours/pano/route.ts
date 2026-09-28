import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { validateMagicNumber } from "@/lib/validate-upload";
import { assertOwnedProperty } from "@/lib/realty/properties";
import {
  REALTY_MAX_PANO_BYTES,
  REALTY_PHOTO_MIME,
  addRealtyStorageBytes,
  assertRealtyStorageRoom,
  extensionForMime,
  realtyStoragePath,
  uploadRealtyFile,
} from "@/lib/realty/media";
import {
  limiteSubidasPorUsuario,
  pareceScriptOMarcado,
  registrarSubidaRechazada,
  tieneExtensionPeligrosa,
} from "@/lib/uploads/validar-archivo";
import { gateRealty, notFound, realtyApiError } from "../../../_helpers";

export const dynamic = "force-dynamic";

const MAX_PANOS = 24;

/**
 * POST — subir UNA panorámica equirectangular propia.
 *
 * Es el segundo camino de los recorridos: el asesor toma la foto 360 con su
 * celular y la enseña en nuestro visor, sin contratar a nadie. A diferencia
 * de la liga externa, esto SÍ ocupa cupo — por eso pasa por la misma puerta
 * de storage que las fotos.
 *
 * Se guarda como RealtyPropertyTour con kind PANO_PROPIA y provider
 * "propio" (el default del schema): no hay proveedor externo que detectar.
 *
 * Ruta estática dentro de /tours: Next la resuelve antes que [tourId], así
 * que "pano" nunca se confunde con el id de un recorrido.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const property = await assertOwnedProperty(ctx, params.id);
    if (!property) return notFound();

    if (!limiteSubidasPorUsuario(`realty:pano:${ctx.accountId}`, 60)) {
      return NextResponse.json(
        { error: "Demasiadas subidas en poco tiempo. Espera un momento e inténtalo de nuevo." },
        { status: 429 },
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "No pudimos leer el archivo." }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se recibió ninguna imagen." }, { status: 400 });
    }
    if (tieneExtensionPeligrosa(file.name)) {
      await registrarSubidaRechazada({
        ruta: "properties/[id]/tours/pano:POST",
        motivo: "extensión peligrosa en el nombre",
        codigo: "extension_peligrosa",
        nombreOriginal: file.name,
      });
      return NextResponse.json(
        { error: "El nombre del archivo tiene una extensión no permitida." },
        { status: 400 },
      );
    }
    if (!REALTY_PHOTO_MIME.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de archivo no permitido. Usa JPG, PNG o WebP." },
        { status: 400 },
      );
    }
    if (file.size > REALTY_MAX_PANO_BYTES) {
      return NextResponse.json(
        { error: "La panorámica supera el máximo de 4 MB después de comprimirla." },
        { status: 400 },
      );
    }

    const bytes = await file.arrayBuffer();
    const marcador = pareceScriptOMarcado(Buffer.from(bytes));
    if (marcador) {
      await registrarSubidaRechazada({
        ruta: "properties/[id]/tours/pano:POST",
        motivo: `contenido parece script o marcado (${marcador.trim()})`,
        codigo: "script_o_marcado",
        nombreOriginal: file.name,
      });
      return NextResponse.json(
        { error: "El contenido del archivo no parece una imagen válida." },
        { status: 400 },
      );
    }
    const magicError = await validateMagicNumber(bytes, REALTY_PHOTO_MIME);
    if (magicError) {
      await registrarSubidaRechazada({
        ruta: "properties/[id]/tours/pano:POST",
        motivo: magicError,
        codigo: "tipo_no_permitido",
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: magicError }, { status: 400 });
    }
    try {
      const metadata = await sharp(Buffer.from(bytes)).metadata();
      if (!metadata.width || !metadata.height) throw new Error("sin dimensiones");
      await sharp(Buffer.from(bytes)).toBuffer();
    } catch {
      await registrarSubidaRechazada({
        ruta: "properties/[id]/tours/pano:POST",
        motivo: "la imagen no se pudo decodificar (está corrupta o no es una imagen real)",
        codigo: "imagen_corrupta",
        nombreOriginal: file.name,
      });
      return NextResponse.json(
        { error: "La imagen no se pudo decodificar (está corrupta o no es una imagen real)." },
        { status: 400 },
      );
    }

    const count = await prisma.realtyPropertyTour.count({
      where: { accountId: ctx.accountId, propertyId: property.id, kind: "PANO_PROPIA" },
    });
    if (count >= MAX_PANOS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_PANOS} panorámicas por inmueble.` },
        { status: 400 },
      );
    }

    await assertRealtyStorageRoom(ctx.accountId, ctx.plan.storageQuotaMb, file.size);

    const buffer = Buffer.from(bytes);
    const path = realtyStoragePath(
      ctx.accountId,
      property.id,
      "panoramicas",
      extensionForMime(file.type),
    );
    await uploadRealtyFile(path, buffer, file.type);

    const tour = await prisma.realtyPropertyTour.create({
      data: {
        accountId: ctx.accountId,
        propertyId: property.id,
        kind: "PANO_PROPIA",
        provider: "propio",
        fileUrl: path,
        bytes: buffer.length,
        sortOrder: count,
      },
      select: { id: true, sortOrder: true },
    });

    await addRealtyStorageBytes(ctx.accountId, buffer.length);

    return NextResponse.json({ tour }, { status: 201 });
  } catch (e) {
    return realtyApiError("properties/[id]/tours/pano:POST", e);
  }
}
