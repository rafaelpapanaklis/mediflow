// Generación de la factura BORRADOR de un presupuesto. Lógica única y
// reutilizable: la usan tanto POST /api/quotes/[id]/invoice (presupuesto
// ACEPTADO) como POST /api/quotes (factura automática al crear). IDEMPOTENTE:
// un presupuesto = una factura. clinicId SIEMPRE del ctx de sesión.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
// round2 sale de invoice-totals (que la re-exporta desde ./compute): una sola
// ruta de módulo para toda la aritmética de la factura.
import { sumInvoiceItems, computeInvoiceTotal, itemLineTotal, round2 } from "@/lib/invoice-totals";
import {
  InvoiceNumberExhaustedError,
  nextInvoiceNumber,
  withInvoiceNumberRetry,
} from "@/lib/invoices/next-invoice-number";
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

  const items = quote.items.map((it) => {
    // Misma regla que itemQuantity() del timbrado (finita >0, si no 1). El
    // `|| 1` anterior dejaba pasar cantidades negativas y ahí los dos lados
    // calculaban importes distintos.
    const rawQty = num(it.quantity);
    const quantity = rawQty > 0 ? rawQty : 1;
    const unitPrice = num(it.unitPrice);
    // El descuento POR LÍNEA del presupuesto viaja con el concepto: la guarda
    // del timbrado (POST /api/cfdi) y el payload a Facturapi calculan
    // qty × unitPrice − discount; sin él, una línea con descuento dejaría
    // total < Σconceptos y el timbrado se bloquearía con un 409 falso.
    // Clamp a importe de línea (regla SAT: descuento ≤ importe).
    const discount = Math.min(round2(num(it.discount)), round2(unitPrice * quantity));
    return {
      description: it.toothFdi ? `${it.name} (${it.toothFdi})` : it.name,
      quantity,
      unitPrice,
      ...(discount > 0 ? { discount } : {}),
      // El importe de línea se DERIVA de los campos ya normalizados, no se copia
      // el `lineTotal` del presupuesto: así el JSON del concepto dice lo mismo
      // que calculan la guarda del timbrado y el comprobante impreso.
      total: itemLineTotal({ quantity, unitPrice, discount }),
    };
  });
  // Los totales de la FACTURA se derivan de SUS conceptos con la aritmética
  // canónica (invoice-totals) — no se copian las columnas del presupuesto, que
  // salen de otra implementación (quotes/compute). Hoy los dos números
  // coinciden, pero es una coincidencia entre dos matemáticas paralelas: lo que
  // la guarda del timbrado verifica es Σ round2(qty × unitPrice − desc.línea),
  // así que ése es el que manda para lo que se va a timbrar. Si algún día
  // divergen, el presupuesto conserva su importe (no se toca) y la factura sale
  // por el derivado de sus conceptos.
  const subtotal = sumInvoiceItems(items);
  // Clamp al subtotal derivado: un descuento mayor dejaría base 0 y un `total`
  // que ya no es Σconceptos − descuento (regla SAT: descuento ≤ importe).
  const discount = round2(Math.min(Math.max(0, num(quote.discountAmount)), subtotal));
  const { total } = computeInvoiceTotal(subtotal, discount, 0, true);

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
