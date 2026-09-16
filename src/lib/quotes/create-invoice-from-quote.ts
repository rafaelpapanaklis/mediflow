// Generación de la factura de un presupuesto ACEPTADO (POST
// /api/quotes/[id]/invoice, botón «Generar factura»). IDEMPOTENTE: un
// presupuesto = una factura. clinicId SIEMPRE del ctx de sesión.
//
// Nace PENDIENTE, igual que la del botón normal (POST /api/invoices): el
// paciente ya aceptó y un presupuesto aceptado ya no se edita, así que no hay
// nada que ajustar antes de emitirla. Hasta sep-2026 nacía en BORRADOR y
// además POST /api/quotes creaba una al CREAR el presupuesto — un presupuesto
// que el paciente aún no aceptaba ya tenía factura y folio gastado. Eso se
// quitó; los borradores de entonces siguen en la base tal cual.
//
// Y su espejo: syncDraftInvoiceFromQuote re-sincroniza la factura BORRADOR de
// esos presupuestos viejos cuando se EDITA el presupuesto (PATCH
// /api/quotes/[id]) con la MISMA aritmética (invoice-from-quote-core). Antes
// el PATCH no tocaba la factura: presupuesto de $10,000 subido a $18,000 → el
// paciente firmaba $18,000 y se cobraba y timbraba la factura de $10,000.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { clinicInvoiceTaxDefaults } from "@/lib/invoice-totals";
import {
  InvoiceNumberExhaustedError,
  nextInvoiceNumber,
  withInvoiceNumberRetry,
} from "@/lib/invoices/next-invoice-number";
import {
  decideLinkedInvoiceLock,
  invoiceFieldsFromQuote,
  quoteInvoiceLockedMessage,
  type LinkedInvoiceLock,
} from "./invoice-from-quote-core";
import type {
  BillingInvoiceItem,
  BillingInvoiceLite,
  BillingPaymentLite,
} from "./types";

/** Contexto mínimo de sesión. SIEMPRE de getAuthContext, nunca del cliente. */
export interface InvoiceFromQuoteCtx {
  clinicId: string;
  userId: string;
}

/** Presupuesto con sus ítems (lo que devuelve createQuoteWithFolio / findFirst con include items). */
interface QuoteItemLike {
  name: string;
  toothFdi: string | null;
  quantity: number;
  unitPrice: Prisma.Decimal | number;
  discount?: Prisma.Decimal | number;
  lineTotal: Prisma.Decimal | number;
}
interface QuoteLike {
  id: string;
  folio: string;
  patientId: string;
  invoiceId: string | null;
  subtotal: Prisma.Decimal | number;
  discountAmount: Prisma.Decimal | number;
  total: Prisma.Decimal | number;
  items: QuoteItemLike[];
}

export interface CreateInvoiceResult {
  invoice: BillingInvoiceLite;
  /** true si la factura ya existía (idempotente) y solo se devolvió, sin crear otra. */
  already: boolean;
}

/** Se lanza cuando no se pudo asignar un folio único tras varios reintentos. */
export class InvoiceFolioError extends Error {
  constructor() {
    super("No se pudo asignar folio de factura");
    this.name = "InvoiceFolioError";
  }
}

function num(x: unknown): number {
  const v = Number(x);
  return isFinite(v) ? v : 0;
}

function iso(x: unknown): string {
  if (x instanceof Date) return isNaN(x.getTime()) ? "" : x.toISOString();
  const d = new Date(x as string);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

function serializeInvoice(inv: any): BillingInvoiceLite {
  const items: BillingInvoiceItem[] = Array.isArray(inv.items)
    ? inv.items.map((it: any) => ({
        description: String(it?.description ?? ""),
        quantity: num(it?.quantity) || 1,
        unitPrice: num(it?.unitPrice),
        total: num(it?.total),
      }))
    : [];
  const payments: BillingPaymentLite[] = Array.isArray(inv.payments)
    ? inv.payments.map((p: any) => ({
        id: p.id,
        amount: num(p.amount),
        method: p.method,
        reference: p.reference ?? null,
        notes: p.notes ?? null,
        paidAt: iso(p.paidAt),
      }))
    : [];
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    patientId: inv.patientId,
    status: inv.status,
    subtotal: num(inv.subtotal),
    discount: num(inv.discount),
    total: num(inv.total),
    paid: num(inv.paid),
    balance: num(inv.balance),
    notes: inv.notes ?? null,
    items,
    payments,
    createdAt: iso(inv.createdAt),
  };
}

/**
 * Crea (o devuelve, si ya existe) la factura PENDIENTE de un presupuesto.
 * IDEMPOTENTE: si el presupuesto ya tiene factura viva, la regresa sin duplicar
 * y sin tocar su estado (un BORRADOR viejo sigue siendo borrador).
 * Aísla SIEMPRE por ctx.clinicId. No valida el status del presupuesto: eso lo
 * hace la ruta (POST /api/quotes/[id]/invoice exige ACCEPTED).
 */
export async function createInvoiceFromQuote(
  quote: QuoteLike,
  ctx: InvoiceFromQuoteCtx,
): Promise<CreateInvoiceResult> {
  // Idempotencia: si ya hay factura viva ligada, regrésala sin duplicar.
  if (quote.invoiceId) {
    const existing = await prisma.invoice.findFirst({
      where: { id: quote.invoiceId, clinicId: ctx.clinicId },
      include: { payments: true },
    });
    if (existing) return { invoice: serializeInvoice(existing), already: true };
  }

  // Conceptos y totales de la FACTURA derivados de SUS conceptos con la
  // aritmética canónica (invoice-from-quote-core → invoice-totals), la misma
  // que verifica la guarda del timbrado y la MISMA que usa la re-sincronización
  // al editar el presupuesto. No se copian las columnas del presupuesto, que
  // salen de otra implementación (quotes/compute): si algún día divergen, el
  // presupuesto conserva su importe y la factura sale por el derivado de sus
  // conceptos.
  const { items, subtotal, discount, total } = invoiceFieldsFromQuote(quote);

  // Impuestos con los que NACE la factura, según la preferencia fiscal de la
  // clínica, igual que la del editor (POST /api/invoices) y la de una cita
  // (from-appointment). Sin esto caía al default de la columna (16 %, incluido)
  // también en una clínica exenta. El total no cambia: los dos modos llevan el
  // IVA incluido. Solo la columna que se necesita: la fila de Clinic lleva secretos.
  const clinicTax = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { cfdiTaxMode: true },
  });
  const { taxRate, taxIncluded } = clinicInvoiceTaxDefaults(clinicTax?.cfdiTaxMode);

  // Folio por MÁXIMO emitido con reintento ante carrera (P0-2). El loop
  // anterior hacía count+1+attempt: con 8 o más huecos por debajo del máximo
  // (esta ruta los fabricaba mientras sus facturas nacían DRAFT y se borraban
  // en duro) los 8 intentos caían todos en folios ya emitidos y la clínica
  // quedaba bloqueada.
  //
  // Crear la factura y ligarla al presupuesto van en UNA transacción, con el
  // presupuesto bloqueado (FOR UPDATE). Antes eran tres pasos sueltos: dos
  // «Generar factura» a la vez (Sabina y la pantalla, dos pestañas) leían los
  // dos `invoiceId` vacío y nacían dos facturas; y si la función moría entre
  // crear y ligar, el botón seguía diciendo «Generar factura» y el segundo clic
  // creaba otra. Con un borrador eso se borraba; con una PENDIENTE es deuda
  // cobrable que solo se anula. Ahora el segundo espera al primero, relee el
  // vínculo y devuelve la misma factura.
  //
  // La transacción se abre DENTRO de withInvoiceNumberRetry (ver su docstring):
  // un P2002 de folio aborta la tx y el reintento necesita una nueva.
  let result: { row: any; already: boolean };
  try {
    result = await withInvoiceNumberRetry(() =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "quotes" WHERE id = ${quote.id} AND "clinicId" = ${ctx.clinicId} FOR UPDATE`;
        const fresh = await tx.quote.findFirst({
          where: { id: quote.id, clinicId: ctx.clinicId },
          select: { invoiceId: true },
        });
        if (!fresh) throw new Error("Presupuesto no encontrado al facturar");
        if (fresh.invoiceId) {
          const existing = await tx.invoice.findFirst({
            where: { id: fresh.invoiceId, clinicId: ctx.clinicId },
            include: { payments: true },
          });
          if (existing) return { row: existing, already: true };
        }
        const created = await tx.invoice.create({
          data: {
            clinicId: ctx.clinicId,
            patientId: quote.patientId,
            invoiceNumber: await nextInvoiceNumber(ctx.clinicId, tx),
            items: items as unknown as Prisma.InputJsonValue,
            subtotal,
            discount,
            total,
            paid: 0,
            balance: total,
            // Emitida y cobrable desde ya, como POST /api/invoices. NO volver a
            // DRAFT: el paciente ya aceptó, y un borrador obliga a «confirmar»
            // antes de cobrar y se puede borrar (su folio se reutiliza).
            status: "PENDING",
            notes: `Generada desde presupuesto ${quote.folio}`,
            taxRate,
            taxIncluded,
          },
        });
        // Vincula la factura al presupuesto (cierra la idempotencia aguas abajo).
        await tx.quote.updateMany({
          where: { id: quote.id, clinicId: ctx.clinicId },
          data: { invoiceId: created.id },
        });
        return { row: { ...created, payments: [] }, already: false };
      }),
    );
  } catch (e) {
    // Se conserva el contrato público de este módulo: los callers ya manejan
    // InvoiceFolioError; el error nuevo del helper se traduce aquí.
    if (e instanceof InvoiceNumberExhaustedError) throw new InvoiceFolioError();
    throw e;
  }
  if (result.already) return { invoice: serializeInvoice(result.row), already: true };
  const created = result.row;

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: created.id,
    action: "create",
    changes: { fromQuote: { before: null, after: quote.folio } },
  });

  return { invoice: serializeInvoice(created), already: false };
}

// ── Re-sincronización al EDITAR el presupuesto (FIN-05) ───────────────

/** La factura ligada ya no admite regenerarse (confirmada o con pagos). */
export class QuoteInvoiceLockedError extends Error {
  readonly lock: LinkedInvoiceLock;
  constructor(lock: LinkedInvoiceLock) {
    super(quoteInvoiceLockedMessage(lock));
    this.name = "QuoteInvoiceLockedError";
    this.lock = lock;
  }
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Lee la factura ligada (aislada por clinicId) y decide si admite regenerarse.
 * `invoice` null = ya no existe (se borró el borrador): no hay nada que
 * sincronizar ni que bloquear. `lock` ≠ null = confirmada o con pagos.
 */
export async function getLinkedInvoiceLock(
  db: Db,
  clinicId: string,
  invoiceId: string,
): Promise<{ invoice: { id: string; invoiceNumber: string; status: string; total: number } | null; lock: LinkedInvoiceLock | null }> {
  const inv = await db.invoice.findFirst({
    where: { id: invoiceId, clinicId },
    select: {
      id: true, invoiceNumber: true, status: true, paid: true, total: true,
      _count: { select: { payments: true } },
    },
  });
  if (!inv) return { invoice: null, lock: null };
  const lock = decideLinkedInvoiceLock({
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    paid: inv.paid,
    paymentsCount: inv._count.payments,
  });
  return { invoice: { id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status, total: inv.total }, lock };
}

/**
 * Regenera conceptos / subtotal / descuento / total / balance de la factura
 * BORRADOR ligada al presupuesto ya editado, con la misma aritmética del alta.
 * Va DENTRO de la transacción del PATCH (mismo `tx` que replaceQuoteContent):
 * o cambian los dos o no cambia ninguno.
 *
 * El `where` exige DRAFT + paid 0 + sin un solo Payment: si entre el pre-check
 * de la ruta y aquí alguien confirmó o cobró la factura, el updateMany no toca
 * nada y se lanza QuoteInvoiceLockedError (la transacción se revierte y el
 * presupuesto tampoco cambia). Devuelve la factura ya sincronizada (null si el
 * borrador ya no existe).
 */
export async function syncDraftInvoiceFromQuote(
  tx: Prisma.TransactionClient,
  quote: QuoteLike,
  ctx: InvoiceFromQuoteCtx,
): Promise<BillingInvoiceLite | null> {
  if (!quote.invoiceId) return null;
  const { items, subtotal, discount, total } = invoiceFieldsFromQuote(quote);
  const res = await tx.invoice.updateMany({
    where: {
      id: quote.invoiceId,
      clinicId: ctx.clinicId,
      status: "DRAFT",
      paid: 0,
      payments: { none: {} },
    },
    data: {
      items: items as unknown as Prisma.InputJsonValue,
      subtotal,
      discount,
      total,
      balance: total,
    },
  });
  if (res.count === 0) {
    const { invoice, lock } = await getLinkedInvoiceLock(tx, ctx.clinicId, quote.invoiceId);
    if (lock) throw new QuoteInvoiceLockedError(lock);
    if (!invoice) return null; // el borrador se borró: el presupuesto sigue editable
    // Sin lock y sin update no debería pasar (el where es exactamente la regla
    // de decideLinkedInvoiceLock); se trata como bloqueo por prudencia.
    throw new QuoteInvoiceLockedError({ invoiceNumber: invoice.invoiceNumber, status: invoice.status, reason: "not-draft" });
  }
  const updated = await tx.invoice.findFirst({
    where: { id: quote.invoiceId, clinicId: ctx.clinicId },
    include: { payments: true },
  });
  return updated ? serializeInvoice(updated) : null;
}
