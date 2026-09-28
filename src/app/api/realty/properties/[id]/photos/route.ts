import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { validateMagicNumber } from "@/lib/validate-upload";
import { assertOwnedProperty } from "@/lib/realty/properties";
import {
  REALTY_MAX_PHOTO_BYTES,
  REALTY_PHOTO_MIME,
  REALTY_PHOTO_URL_TTL,
  addRealtyStorageBytes,
  applyRealtyWatermark,
  assertRealtyStorageRoom,
  extensionForMime,
  imageDimensions,
  loadAccountLogo,
  realtyStoragePath,
  signRealtyUrl,
  uploadRealtyFile,
} from "@/lib/realty/media";
import {
  limiteSubidasPorUsuario,
  pareceScriptOMarcado,
  registrarSubidaRechazada,
  tieneExtensionPeligrosa,
} from "@/lib/uploads/validar-archivo";
import { gateRealty, notFound, realtyApiError } from "../../_helpers";

export const dynamic = "force-dynamic";

/**
 * POST — subir UNA foto del inmueble.
 *
 * El orden importa y no es negociable:
 *   1. sesión + plan + permiso (la puerta única)
 *   2. el inmueble es de ESTA cuenta
 *   3. tipo y tamaño, y el MAGIC NUMBER real (el mime del navegador se
 *      falsea con dos clics)
 *   4. ¿hay cupo? → ANTES de tocar el bucket. Si no, no queremos el objeto
 *      arriba y la fila abajo sin cuadrar.
 *   5. marca de agua (si la pidieron y la cuenta tiene logo)
 *   6. subir, crear la fila y SUMAR los bytes al consumo
 *
 * El paso 6 es el que se olvida siempre, y es el que hace que el contador
 * de la cuenta mienta. Aquí va explícito.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const property = await assertOwnedProperty(ctx, params.id);
    if (!property) return notFound();

    if (!limiteSubidasPorUsuario(`realty:foto:${ctx.accountId}`, 60)) {
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
        ruta: "properties/[id]/photos:POST",
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
    if (file.size > REALTY_MAX_PHOTO_BYTES) {
      return NextResponse.json(
        { error: "La imagen supera el máximo de 4 MB después de comprimirla." },
        { status: 400 },
      );
    }

    const bytes = await file.arrayBuffer();
    const marcador = pareceScriptOMarcado(Buffer.from(bytes));
    if (marcador) {
      await registrarSubidaRechazada({
        ruta: "properties/[id]/photos:POST",
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
        ruta: "properties/[id]/photos:POST",
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
        ruta: "properties/[id]/photos:POST",
        motivo: "la imagen no se pudo decodificar (está corrupta o no es una imagen real)",
        codigo: "imagen_corrupta",
        nombreOriginal: file.name,
      });
      return NextResponse.json(
        { error: "La imagen no se pudo decodificar (está corrupta o no es una imagen real)." },
        { status: 400 },
      );
    }

    // Lanza RealtyStorageFullError → 413 con código STORAGE_FULL.
    await assertRealtyStorageRoom(ctx.accountId, ctx.plan.storageQuotaMb, file.size);

    // Anotado a mano: Buffer.from(ArrayBuffer) da Buffer<ArrayBuffer>, y la
    // marca de agua devuelve el Buffer genérico. Sin el tipo explícito, TS
    // rechaza la reasignación.
    let buffer: Buffer = Buffer.from(bytes);
    let watermarked = false;
    if (form.get("watermark") === "1" && ctx.account.logoUrl) {
      const logo = await loadAccountLogo(ctx.account.logoUrl, ctx.accountId);
      const stamped = await applyRealtyWatermark(buffer, logo);
      buffer = stamped.buffer;
      watermarked = stamped.watermarked;
    }

    const dims = await imageDimensions(buffer);
    const path = realtyStoragePath(
      ctx.accountId,
      property.id,
      "fotos",
      extensionForMime(file.type),
    );
    await uploadRealtyFile(path, buffer, file.type);

    // La PRIMERA foto es la portada: nadie tiene que acordarse de marcarla,
    // y una tarjeta sin portada en el listado se ve rota.
    const count = await prisma.realtyPropertyPhoto.count({
      where: { accountId: ctx.accountId, propertyId: property.id },
    });

    const photo = await prisma.realtyPropertyPhoto.create({
      data: {
        accountId: ctx.accountId,
        propertyId: property.id,
        url: path,
        bytes: buffer.length,
        width: dims.width,
        height: dims.height,
        sortOrder: count,
        isCover: count === 0,
        watermarked,
      },
    });

    await addRealtyStorageBytes(ctx.accountId, buffer.length);

    return NextResponse.json(
      {
        photo: {
          id: photo.id,
          sortOrder: photo.sortOrder,
          url: await signRealtyUrl(path, REALTY_PHOTO_URL_TTL),
          width: photo.width,
          height: photo.height,
          bytes: photo.bytes,
          isCover: photo.isCover,
          watermarked: photo.watermarked,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    return realtyApiError("properties/[id]/photos:POST", e);
  }
}
