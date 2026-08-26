// La BÓVEDA: abrir, archivar y (sólo cuando la ley ya lo permite) borrar.
//
//   GET    → URL firmada de vida corta + renglón en la bitácora.
//   PATCH  → archivar / desarchivar.
//   DELETE → borrar de verdad. SOLO si ya pasó `retainUntil`.
//
// ── 🔴 LA REGLA DE LOS DIEZ AÑOS SE HACE VALER AQUÍ ───────────────────
// `retainUntil` se calculó al subir, con el plazo que dijera el parámetro.
// Mientras esa fecha no pase, DELETE responde 409 y no toca nada: la UI
// archiva. Un `archivedAt` no borra el objeto del bucket ni el renglón de
// la base — solo lo saca de la vista y hace que deje de contar para el
// estado del expediente.
//
// El corte NO se hace en el navegador. La UI esconde el botón de borrar,
// pero quien llame a la API a mano se topa con el mismo 409: esconder un
// botón no es control de acceso.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addRealtyStorageBytes, removeRealtyFiles } from "@/lib/realty/media";
import { pathBelongsToAccount } from "@/lib/realty/media";
import { firmarPapelPld } from "@/lib/realty/pld/almacen";
import { registrarAcceso } from "@/lib/realty/pld/bitacora";
import { recalcularRiesgo } from "@/lib/realty/pld/expedientes";
import { errorPld, gatePld, leerJson, noEncontrado } from "../../_guard";

export const dynamic = "force-dynamic";

/** El papel, SIEMPRE recortado a la cuenta de la sesión. */
async function papelDeLaCuenta(accountId: string, id: string) {
  return prisma.realtyPldDocument.findFirst({
    where: { id, accountId },
    select: {
      id: true,
      fileId: true,
      name: true,
      url: true,
      bytes: true,
      retainUntil: true,
      archivedAt: true,
    },
  });
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  // Abrir un papel pide solo pld.view: un oficial de cumplimiento con
  // acceso de lectura tiene que poder revisar el expediente.
  const gate = await gatePld("pld.view");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const doc = await papelDeLaCuenta(ctx.accountId, params.id);
    if (!doc) return noEncontrado("Ese documento ya no existe.");

    // Defensa en profundidad: la fila ya vino filtrada por accountId, pero
    // al Storage jamás se le pasa un path que no empiece por la cuenta viva.
    if (!pathBelongsToAccount(doc.url, ctx.accountId)) {
      console.error(`[api/realty/pld/documentos] path fuera de la cuenta: ${doc.id}`);
      return noEncontrado("Ese documento ya no existe.");
    }

    // 🔴 Se registra ANTES de devolver la URL. Nunca se entrega un papel sin
    // intentar dejar constancia; y registrarAcceso nunca lanza, así que un
    // fallo de bitácora no deja al usuario sin su documento.
    await registrarAcceso(
      ctx,
      { action: "ABRIR_DOCUMENTO", fileId: doc.fileId, documentId: doc.id },
      req,
    );

    const url = await firmarPapelPld(doc.url);
    if (!url) {
      return NextResponse.json(
        { error: "No pudimos abrir el documento. Inténtalo otra vez." },
        { status: 502 },
      );
    }
    return NextResponse.json({ url, name: doc.name });
  } catch (e) {
    return errorPld("documentos/abrir", e);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gatePld("pld.manage");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const doc = await papelDeLaCuenta(ctx.accountId, params.id);
    if (!doc) return noEncontrado("Ese documento ya no existe.");

    const body = await leerJson(req);
    const archivar = body.archivar !== false;

    // updateMany con accountId, no update por id: un id ajeno devuelve
    // count 0 en vez de editar la fila de otra inmobiliaria.
    await prisma.realtyPldDocument.updateMany({
      where: { id: doc.id, accountId: ctx.accountId },
      data: { archivedAt: archivar ? new Date() : null },
    });

    // Archivar cambia el estado del expediente (un papel archivado deja de
    // contar), así que el riesgo se recalcula.
    await recalcularRiesgo(ctx, doc.fileId);
    await registrarAcceso(
      ctx,
      { action: "ARCHIVAR_DOCUMENTO", fileId: doc.fileId, documentId: doc.id },
      req,
    );

    return NextResponse.json({ ok: true, archivado: archivar });
  } catch (e) {
    return errorPld("documentos/archivar", e);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const gate = await gatePld("pld.manage");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const doc = await papelDeLaCuenta(ctx.accountId, params.id);
    if (!doc) return noEncontrado("Ese documento ya no existe.");

    if (doc.retainUntil.getTime() >= Date.now()) {
      const cuando = new Intl.DateTimeFormat("es-MX", {
        dateStyle: "long",
        timeZone: ctx.account.timezone || "America/Mexico_City",
      }).format(doc.retainUntil);
      return NextResponse.json(
        {
          error:
            `Este documento se tiene que conservar hasta el ${cuando}. Mientras tanto no se ` +
            "borra: archívalo si ya no lo ocupas y seguirá guardado.",
          code: "RETENTION_ACTIVE",
          retainUntil: doc.retainUntil.toISOString(),
        },
        { status: 409 },
      );
    }

    // El objeto del bucket primero. Si falla, removeRealtyFiles solo avisa
    // en el log: quedarse con una fila que apunta a un archivo inexistente
    // es peor que un huérfano en el bucket.
    if (pathBelongsToAccount(doc.url, ctx.accountId)) {
      await removeRealtyFiles([doc.url]);
    }
    const borradas = await prisma.realtyPldDocument.deleteMany({
      where: { id: doc.id, accountId: ctx.accountId },
    });
    if (borradas.count > 0) {
      await addRealtyStorageBytes(ctx.accountId, -doc.bytes);
      await recalcularRiesgo(ctx, doc.fileId);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorPld("documentos/borrar", e);
  }
}
