import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { replaceQuoteContent, parseValidUntil } from "@/lib/quotes/service";
import { serializeQuote } from "@/lib/quotes/serialize";
import {
  QuoteInvoiceLockedError,
  getLinkedInvoiceLock,
  syncDraftInvoiceFromQuote,
} from "@/lib/quotes/create-invoice-from-quote";
import type { BillingInvoiceLite } from "@/lib/quotes/types";
import { normalizarCondiciones } from "@/lib/quotes/condiciones-pago";
import { guardarCondiciones, leerCondiciones } from "@/lib/quotes/condiciones-pago-db";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/** GET /api/quotes/[id] — un presupuesto de la clínica de la sesión. */
export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { firstName: true, lastName: true } },
      patient: { select: { firstName: true, lastName: true } },
    },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  // Visibilidad por paciente: no exponer el presupuesto (incluye nombre del
  // paciente) a quien no puede ver a ese paciente. Solo aplica si tiene paciente.
  if (quote.patientId) {
    const denied = await assertPatientVisible(quote.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }

  const leidas = await leerCondiciones(prisma, quote.id);
  return NextResponse.json(serializeQuote(quote, leidas.condiciones, leidas.fallo));
}

/**
 * PATCH /api/quotes/[id] — edita un presupuesto. Solo en estado editable
 * (DRAFT o PRESENTED). Reemplaza ítems y recalcula totales en el servidor.
 *
 * FIN-05 — la factura ligada (quote.invoiceId, la que POST /api/quotes crea
 * en BORRADOR) se regenera en la MISMA transacción con la misma aritmética
 * del alta. Si esa factura ya se confirmó o tiene pagos, el presupuesto ya no
 * se edita: 409 con un mensaje que dice qué factura, por qué y qué hacer.
 * Devuelve `invoice` (la sincronizada) para que la ficha la refresque al
 * instante, o null si no había.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular: este PATCH no edita solo el presupuesto — reescribe
  // total, descuento, ítems y saldo de la factura ligada
  // (syncDraftInvoiceFromQuote, en la transacción de abajo). Es exactamente lo
  // que hace PATCH /api/invoices/[id] por la otra puerta, y esa exige
  // "billing.edit": misma acción, misma key.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.edit");
  if (deniedPerm) return deniedPerm;

  const existing = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, status: true, total: true, patientId: true, invoiceId: true },
  });
  if (!existing) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  // Visibilidad por paciente: no permitir editar el presupuesto de un paciente
  // que este usuario no puede ver.
  if (existing.patientId) {
    const denied = await assertPatientVisible(existing.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }

  if (existing.status !== "DRAFT" && existing.status !== "PRESENTED") {
    return NextResponse.json(
      { error: "Solo se pueden editar presupuestos en borrador o presentados" },
      { status: 409 },
    );
  }

  // Pre-check de la factura ligada ANTES de leer el body: si ya está
  // confirmada o cobrada, el 409 sale con el mensaje claro y sin tocar nada.
  // Dentro de la transacción se vuelve a exigir (carrera entre este check y
  // el update).
  let linked: { id: string; invoiceNumber: string; total: number } | null = null;
  if (existing.invoiceId) {
    const { invoice, lock } = await getLinkedInvoiceLock(prisma, ctx.clinicId, existing.invoiceId);
    if (lock) {
      return NextResponse.json(
        { error: new QuoteInvoiceLockedError(lock).message, code: "QUOTE_INVOICE_LOCKED", invoiceNumber: lock.invoiceNumber },
        { status: 409 },
      );
    }
    linked = invoice;
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? (body.items as never[]) : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Agrega al menos un concepto" }, { status: 400 });
  }

  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, 160)
    : "Presupuesto";
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;
  const validUntil = parseValidUntil(body.validUntil);

  let quote: Awaited<ReturnType<typeof replaceQuoteContent>>;
  let invoice: BillingInvoiceLite | null = null;
  try {
    ({ quote, invoice } = await prisma.$transaction(async (tx) => {
      const q = await replaceQuoteContent({
        quoteId: existing.id,
        clinicId: ctx.clinicId,
        title,
        items,
        discountPct: body.discountPct == null ? null : Number(body.discountPct),
        discountAmount: body.discountAmount == null ? null : Number(body.discountAmount),
        validUntil,
        notes,
        tx,
      });
      // Borrador ligado → misma aritmética del alta, misma transacción.
      const inv = linked
        ? await syncDraftInvoiceFromQuote(tx, q, { clinicId: ctx.clinicId, userId: ctx.userId })
        : null;
      return { quote: q, invoice: inv };
    }));
  } catch (e) {
    if (e instanceof QuoteInvoiceLockedError) {
      return NextResponse.json(
        { error: e.message, code: "QUOTE_INVOICE_LOCKED", invoiceNumber: e.lock.invoiceNumber },
        { status: 409 },
      );
    }
    throw e;
  }

  // Formas de pago. FUERA de la transacción del presupuesto, a propósito: van
  // en una tabla que puede no existir todavía y su escritura es best-effort —
  // no puede tumbar ni revertir el guardado del presupuesto ni la
  // re-sincronización de la factura, que es lo que de verdad mueve dinero.
  //
  // 🔴 SOLO si el cuerpo TRAE el campo. Un PATCH que no lo menciona no las
  // toca. Antes se llamaba siempre, y como `normalizarCondiciones(undefined)`
  // devuelve las condiciones vacías, la escritura BORRABA la fila: el editor de
  // siempre (que nunca manda este campo) le arrancaba el plan de pagos, en
  // silencio y sin rastro, a un presupuesto que el paciente ya había firmado a
  // 12 mensualidades. Ausente = «no lo cambies»; presente = lo que diga, y unas
  // condiciones vacías sí borran, que es como se quitan a propósito.
  const tocaCondiciones = Object.prototype.hasOwnProperty.call(body, "condicionesPago");
  const guardado = tocaCondiciones
    ? await guardarCondiciones(prisma, {
        quoteId: quote.id,
        clinicId: ctx.clinicId,
        condiciones: normalizarCondiciones(body.condicionesPago, Number(quote.total)),
      })
    : { ...(await leerCondiciones(prisma, quote.id)), fallo: false };

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "quote",
    entityId: quote.id,
    action: "update",
    changes: { total: { before: Number(existing.total), after: Number(quote.total) } },
  });

  if (invoice && linked) {
    await logAudit({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "invoice",
      entityId: invoice.id,
      action: "update",
      changes: {
        total: { before: Number(linked.total), after: Number(invoice.total) },
        syncedFromQuote: { before: null, after: quote.folio },
      },
    });
  }

  return NextResponse.json({
    ...serializeQuote(quote, guardado.condiciones),
    invoice,
    // Solo cuando había un plan que guardar y la base falló: el editor lo dice
    // en vez de cerrarse como si se hubiera guardado.
    ...(guardado.fallo ? { condicionesPagoFallo: true } : {}),
  });
}

/** DELETE /api/quotes/[id] — borra un presupuesto (solo DRAFT). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Misma key que el PATCH: borrar el presupuesto es la otra mitad de editarlo,
  // y su factura ligada NO se borra con él (quote.invoiceId es una columna
  // suelta, sin FK), así que el borrado deja viva una factura en borrador con
  // folio ya quemado. Una sola llave para toda la superficie de edición.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.edit");
  if (deniedPerm) return deniedPerm;

  const existing = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, status: true, folio: true, patientId: true },
  });
  if (!existing) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  // Visibilidad por paciente: no permitir borrar el presupuesto de un paciente
  // que este usuario no puede ver.
  if (existing.patientId) {
    const denied = await assertPatientVisible(existing.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }

  if (existing.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Solo se pueden eliminar presupuestos en borrador" },
      { status: 409 },
    );
  }

  await prisma.quote.delete({ where: { id: existing.id } });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "quote",
    entityId: existing.id,
    action: "delete",
    changes: { folio: { before: existing.folio, after: null } },
  });

  return NextResponse.json({ success: true });
}
