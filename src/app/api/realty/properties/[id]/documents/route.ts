import { NextResponse } from "next/server";
import { fileTypeFromBuffer } from "file-type";
import { prisma } from "@/lib/prisma";
import { validateMagicNumber } from "@/lib/validate-upload";
import { assertOwnedProperty } from "@/lib/realty/properties";
import {
  REALTY_DOC_MIME,
  REALTY_MAX_DOC_BYTES,
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
  verificarPdfPeligroso,
} from "@/lib/uploads/validar-archivo";
import { enumParam, gateRealty, notFound, realtyApiError } from "../../_helpers";

export const dynamic = "force-dynamic";

const DOC_KINDS = ["ESCRITURA", "PREDIAL", "REGIMEN", "IDENTIFICACION", "OTRO"] as const;
const MAX_DOCS = 40;

/**
 * POST — subir un documento del inmueble (escritura, predial, régimen, ID).
 *
 * 🔴 SON PRIVADOS Y NO SALEN A NINGÚN LADO. El bucket realty-files no es
 * público y estos archivos se leen SIEMPRE con una URL firmada de cinco
 * minutos, después de comprobar el accountId de la sesión. No aparecen en
 * la web pública ni en la ficha PDF que se manda por WhatsApp: es la
 * escritura de la casa de alguien.
 *
 * El nombre que se guarda es el que puso el usuario (para reconocerlo en la
 * lista), pero el NOMBRE DEL OBJETO en el bucket se genera: un
 * "../../otra-cuenta/x.pdf" en el nombre original sería una fuga.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const property = await assertOwnedProperty(ctx, params.id);
    if (!property) return notFound();

    if (!limiteSubidasPorUsuario(`realty:doc:${ctx.accountId}`, 60)) {
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
      return NextResponse.json({ error: "No se recibió ningún documento." }, { status: 400 });
    }
    if (tieneExtensionPeligrosa(file.name)) {
      await registrarSubidaRechazada({
        ruta: "properties/[id]/documents:POST",
        motivo: "extensión peligrosa en el nombre",
        codigo: "extension_peligrosa",
        nombreOriginal: file.name,
      });
      return NextResponse.json(
        { error: "El nombre del archivo tiene una extensión no permitida." },
        { status: 400 },
      );
    }
    if (!REALTY_DOC_MIME.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de archivo no permitido. Usa PDF, JPG, PNG o WebP." },
        { status: 400 },
      );
    }
    if (file.size > REALTY_MAX_DOC_BYTES) {
      return NextResponse.json(
        { error: "El documento supera el máximo de 4 MB." },
        { status: 400 },
      );
    }

    const bytes = await file.arrayBuffer();
    const buf = Buffer.from(bytes);
    const marcador = pareceScriptOMarcado(buf);
    if (marcador) {
      await registrarSubidaRechazada({
        ruta: "properties/[id]/documents:POST",
        motivo: `contenido parece script o marcado (${marcador.trim()})`,
        codigo: "script_o_marcado",
        nombreOriginal: file.name,
      });
      return NextResponse.json(
        { error: "El contenido del archivo no parece un documento válido." },
        { status: 400 },
      );
    }
    const magicError = await validateMagicNumber(bytes, REALTY_DOC_MIME);
    if (magicError) {
      await registrarSubidaRechazada({
        ruta: "properties/[id]/documents:POST",
        motivo: magicError,
        codigo: "tipo_no_permitido",
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: magicError }, { status: 400 });
    }

    const tipoReal = await fileTypeFromBuffer(buf);
    if (tipoReal?.mime === "application/pdf") {
      const motivoPdf = verificarPdfPeligroso(buf);
      if (motivoPdf) {
        await registrarSubidaRechazada({
          ruta: "properties/[id]/documents:POST",
          motivo: motivoPdf,
          codigo: "pdf_peligroso",
          nombreOriginal: file.name,
        });
        return NextResponse.json(
          { error: `El PDF contiene ${motivoPdf}, no se acepta.` },
          { status: 400 },
        );
      }
    }

    const count = await prisma.realtyPropertyDocument.count({
      where: { accountId: ctx.accountId, propertyId: property.id },
    });
    if (count >= MAX_DOCS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_DOCS} documentos por inmueble.` },
        { status: 400 },
      );
    }

    await assertRealtyStorageRoom(ctx.accountId, ctx.plan.storageQuotaMb, file.size);

    const buffer = Buffer.from(bytes);
    const path = realtyStoragePath(
      ctx.accountId,
      property.id,
      "documentos",
      extensionForMime(file.type),
    );
    await uploadRealtyFile(path, buffer, file.type);

    const name =
      (typeof file.name === "string" ? file.name : "").trim().slice(0, 160) || "Documento";

    const doc = await prisma.realtyPropertyDocument.create({
      data: {
        accountId: ctx.accountId,
        propertyId: property.id,
        kind: enumParam(form.get("kind"), DOC_KINDS) ?? "OTRO",
        name,
        url: path,
        bytes: buffer.length,
      },
      select: { id: true, kind: true, name: true, bytes: true, createdAt: true },
    });

    await addRealtyStorageBytes(ctx.accountId, buffer.length);

    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (e) {
    return realtyApiError("properties/[id]/documents:POST", e);
  }
}
