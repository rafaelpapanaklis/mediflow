// POST /api/realty/pld/expedientes/[id]/documentos — subir un papel.
//
// 🔴 LO QUE SE SUBE AQUÍ ES LA CREDENCIAL DE ALGUIEN. Va al bucket PRIVADO
// realty-files, con el path empezando por el accountId, y se lee siempre
// con una URL firmada de vida corta. No sale a la web pública, no viaja en
// la ficha PDF y no se manda por WhatsApp.
//
// 🔴 NO SE ACEPTA LA SUBIDA SIN EL PARÁMETRO DE CONSERVACIÓN. `retainUntil`
// es una columna NOT NULL y no puede rellenarse con un 10 escrito en
// código. Sin el parámetro capturado, la subida se rechaza con un mensaje
// que dice exactamente qué falta — es preferible a guardar un papel sin
// saber cuánto hay que conservarlo, porque entonces la UI creería que se
// puede borrar.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateMagicNumber } from "@/lib/validate-upload";
import {
  REALTY_DOC_MIME,
  REALTY_MAX_DOC_BYTES,
  addRealtyStorageBytes,
  assertRealtyStorageRoom,
  uploadRealtyFile,
} from "@/lib/realty/media";
import { pldStoragePath } from "@/lib/realty/pld/almacen";
import { registrarAcceso } from "@/lib/realty/pld/bitacora";
import {
  PLD_DOC_KINDS,
  calcularConservacion,
  recalcularRiesgo,
  vigenciaPorOmision,
} from "@/lib/realty/pld/expedientes";
import { getPldParams } from "@/lib/realty/pld/parametros";
import { fechaDeCalendario } from "@/lib/realty/pld/umbrales";
import type { PldDocKind } from "@/lib/realty/pld/contrato";
import { errorPld, gatePld, malaPeticion, noEncontrado } from "../../../_guard";

export const dynamic = "force-dynamic";

/** Tope de papeles por expediente. Una red, no una regla de negocio. */
const MAX_DOCS = 60;

/**
 * La fecha de expedición y la de vigencia son FECHAS DE CALENDARIO, no
 * instantes: se guardan al mediodía UTC (ver HORA_DE_CALENDARIO en
 * umbrales.ts). A medianoche, un comprobante expedido el 1 de marzo salía
 * como 28 de febrero en toda la República.
 */
function fechaOpcional(raw: FormDataEntryValue | null): Date | null {
  return fechaDeCalendario(typeof raw === "string" ? raw : null);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await gatePld("pld.manage");
  if ("response" in gate) return gate.response;
  const { ctx, nombreUsuario } = gate;

  try {
    // El expediente tiene que ser de ESTA cuenta. Sin este findFirst, un id
    // ajeno colgaría un papel del expediente de otra inmobiliaria.
    const expediente = await prisma.realtyPldFile.findFirst({
      where: { id: params.id, accountId: ctx.accountId },
      select: { id: true },
    });
    if (!expediente) return noEncontrado("Ese expediente ya no existe.");

    const resueltos = await getPldParams();
    if (!resueltos.ok) {
      return NextResponse.json(
        {
          error:
            "No podemos guardar el papel todavía: falta capturar cuántos años hay que conservar " +
            "la documentación, en el panel de DaleControl (Inmobiliarias → Parámetros).",
          code: "PARAM_MISSING",
          faltantes: resueltos.faltantes,
        },
        { status: 409 },
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return malaPeticion("No pudimos leer el archivo.");
    }

    const file = form.get("file");
    if (!(file instanceof File)) return malaPeticion("No se recibió ningún documento.");
    if (!REALTY_DOC_MIME.includes(file.type)) {
      return malaPeticion("Tipo de archivo no permitido. Usa PDF, JPG, PNG o WebP.");
    }
    if (file.size > REALTY_MAX_DOC_BYTES) {
      return malaPeticion("El documento supera el máximo de 4 MB.");
    }

    const rawKind = form.get("kind");
    const kind: PldDocKind =
      typeof rawKind === "string" && (PLD_DOC_KINDS as string[]).includes(rawKind)
        ? (rawKind as PldDocKind)
        : "OTRO";

    const bytes = await file.arrayBuffer();
    // El MIME que manda el navegador es una sugerencia. Esto mira los
    // primeros bytes del archivo de verdad.
    const magicError = await validateMagicNumber(bytes, REALTY_DOC_MIME);
    if (magicError) return malaPeticion(magicError);

    const count = await prisma.realtyPldDocument.count({
      where: { accountId: ctx.accountId, fileId: expediente.id },
    });
    if (count >= MAX_DOCS) {
      return malaPeticion(`Máximo ${MAX_DOCS} documentos por expediente.`);
    }

    await assertRealtyStorageRoom(ctx.accountId, ctx.plan.storageQuotaMb, file.size);

    const ahora = new Date();
    const issuedAt = fechaOpcional(form.get("issuedAt"));
    const expiresAt =
      fechaOpcional(form.get("expiresAt")) ??
      vigenciaPorOmision(kind, resueltos.params, issuedAt);
    const retainUntil = calcularConservacion(resueltos.params, ahora);
    if (!retainUntil) return malaPeticion("No pudimos calcular el plazo de conservación.");

    const path = pldStoragePath(ctx.accountId, expediente.id, file.type);
    await uploadRealtyFile(path, Buffer.from(bytes), file.type);

    // El nombre que ve la persona es el que ella escribió (o el del
    // archivo); el nombre del OBJETO en el bucket se generó arriba. Un
    // "../../otra-cuenta/x.pdf" en el nombre original no llega al Storage.
    const rawName = form.get("name");
    const nombre =
      (typeof rawName === "string" && rawName.trim()) || file.name || "Documento";

    let doc: { id: string };
    try {
      doc = await prisma.realtyPldDocument.create({
        data: {
          accountId: ctx.accountId,
          fileId: expediente.id,
          kind,
          name: nombre.slice(0, 160),
          url: path,
          bytes: file.size,
          issuedAt,
          expiresAt,
          retainUntil,
          uploadedById: ctx.realtyUserId,
          uploadedByName: nombreUsuario,
        },
        select: { id: true },
      });
    } catch (e) {
      // El objeto YA está arriba y la fila no se pudo crear: sin fila nadie
      // lo va a poder borrar nunca. Se limpia antes de propagar.
      const { removeRealtyFiles } = await import("@/lib/realty/media");
      await removeRealtyFiles([path]);
      throw e;
    }

    await addRealtyStorageBytes(ctx.accountId, file.size);
    await recalcularRiesgo(ctx, expediente.id);
    await registrarAcceso(
      ctx,
      { action: "VER_EXPEDIENTE", fileId: expediente.id, documentId: doc.id },
      req,
    );

    return NextResponse.json({ ok: true, id: doc.id });
  } catch (e) {
    return errorPld("documentos", e);
  }
}
