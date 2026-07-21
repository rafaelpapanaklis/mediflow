// Generación de la factura BORRADOR de un presupuesto. Lógica única y
// reutilizable: la usan tanto POST /api/quotes/[id]/invoice (presupuesto
// ACEPTADO) como POST /api/quotes (factura automática al crear). IDEMPOTENTE:
// un presupuesto = una factura. clinicId SIEMPRE del ctx de sesión.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { round2 } from "./compute";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeInvoice(inv: any): BillingInvoiceLite {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: BillingInvoiceItem[] = Array.isArray(inv.items)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inv.items.map((it: any) => ({
        description: String(it?.description ?? ""),
        quantity: num(it?.quantity) || 1,
        unitPrice: num(it?.unitPrice),
        total: num(it?.total),
      }))
    : [];
  const payments: BillingPaymentLite[] = Array.isArray(inv.payments)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inv.payments.map((p: any) => ({
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
    const quantity = num(it.quantity) || 1;
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
      total: num(it.lineTotal),
    };
  });
  const subtotal = num(quote.subtotal);
  const discount = num(quote.discountAmount);
  const total = num(quote.total);

  // Folio MF-XXXX por clínica, con reintento ante carrera (unique compuesto).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let created: any = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const count = await prisma.invoice.count({ where: { clinicId: ctx.clinicId } });
    const invoiceNumber = `MF-${String(count + 1 + attempt).padStart(4, "0")}`;
    try {
      created = await prisma.invoice.create({
        data: {
          clinicId: ctx.clinicId,
          patientId: quote.patientId,
          invoiceNumber,
          items: items as unknown as Prisma.InputJsonValue,
          subtotal,
          discount,
          total,
          paid: 0,
          balance: total,
          status: "DRAFT",
          notes: `Generada desde presupuesto ${quote.folio}`,
        },
      });
      break;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  if (!created) throw new InvoiceFolioError();

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
