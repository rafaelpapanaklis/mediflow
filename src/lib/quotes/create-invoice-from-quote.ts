// Generación de la factura BORRADOR de un presupuesto. Lógica única y
// reutilizable: la usan tanto POST /api/quotes/[id]/invoice (presupuesto
// ACEPTADO) como POST /api/quotes (factura automática al crear). IDEMPOTENTE:
// un presupuesto = una factura. clinicId SIEMPRE del ctx de sesión.
//
// Y su espejo: syncDraftInvoiceFromQuote re-sincroniza esa factura BORRADOR
// cuando se EDITA el presupuesto (PATCH /api/quotes/[id]) con la MISMA
// aritmética (invoice-from-quote-core). Antes el PATCH no tocaba la factura:
// presupuesto de $10,000 subido a $18,000 → el paciente firmaba $18,000 y se
// cobraba y timbraba la factura de $10,000.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
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
 * Crea (o devuelve, si ya existe) la factura BORRADOR de un presupuesto.
 * IDEMPOTENTE: si el presupuesto ya tiene factura viva, la regresa sin duplicar.
 * Aísla SIEMPRE por ctx.clinicId. No valida el status del presupuesto: eso es
 * decisión de cada ruta (el endpoint [id]/invoice exige ACCEPTED; la creación
 * automática no).
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

  // Folio por MÁXIMO emitido con reintento ante carrera (P0-2). El loop
  // anterior hacía count+1+attempt: con 8 o más huecos por debajo del máximo
  // (justo esta ruta los fabrica, porque sus DRAFT se borran en duro) los 8
  // intentos caían todos en folios ya emitidos y la clínica quedaba bloqueada.
  let created: any;
  try {
    created = await withInvoiceNumberRetry(async () =>
      prisma.invoice.create({
        data: {
          clinicId: ctx.clinicId,
          patientId: quote.patientId,
          invoiceNumber: await nextInvoiceNumber(ctx.clinicId),
          items: items as unknown as Prisma.InputJsonValue,
          subtotal,
          discount,
          total,
          paid: 0,
          balance: total,
          status: "DRAFT",
          notes: `Generada desde presupuesto ${quote.folio}`,
        },
      }),
    );
  } catch (e) {
    // Se conserva el contrato público de este módulo: los callers ya manejan
    // InvoiceFolioError; el error nuevo del helper se traduce aquí.
    if (e instanceof InvoiceNumberExhaustedError) throw new InvoiceFolioError();
    throw e;
  }

  // Vincula la factura al presupuesto (cierra la idempotencia aguas abajo).
  await prisma.quote.update({ where: { id: quote.id }, data: { invoiceId: created.id } });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: created.id,
    action: "create",
    changes: { fromQuote: { before: null, after: quote.folio } },
  });

  return { invoice: serializeInvoice({ ...created, payments: [] }), already: false };
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
