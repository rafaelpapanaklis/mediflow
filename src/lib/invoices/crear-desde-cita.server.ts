// Crea la Invoice de una cita a partir de sus conceptos — la MISMA aritmética
// que usaban POST /api/invoices/from-appointment y (ws1-t3 fase 1) el endpoint
// de «Pedir anticipo» cuando la cita todavía no tiene factura. Antes vivía
// solo dentro de la ruta; se extrae aquí para que los dos caminos calculen el
// dinero exactamente igual (subtotal, impuestos, folio) y no diverjan.
//
// NO valida sesión ni permisos: eso es responsabilidad de quien llama. Sí
// valida que la cita no tenga ya una factura (devuelve la existente, nunca
// duplica) y reintenta el folio ante una carrera.

// Sin "server-only" a propósito: lo importan servicios que los tests cargan
// con tsx/node:test (mismo criterio que anticipos/servicio.server.ts).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumInvoiceItems, computeInvoiceTotal, itemLineTotal, clinicInvoiceTaxDefaults, round2 } from "@/lib/invoice-totals";
import { InvoiceNumberExhaustedError, nextInvoiceNumber, withInvoiceNumberRetry } from "@/lib/invoices/next-invoice-number";
import { aplicarSaldoAFavor } from "@/lib/patient-credit-aplicar";

export interface LineItemFactura {
  code?: string;
  description: string;
  toothNumber?: number;
  surface?: string | null;
  unitPrice: number;
  quantity: number;
}

export interface CrearFacturaDesdeCitaArgs {
  clinicId: string;
  appointmentId: string;
  patientId: string;
  lineItems: LineItemFactura[];
  discount?: number;
  notes?: string | null;
  /** Quién la crea, para el rastro de `aplicarSaldoAFavor`. null = automático. */
  userId?: string | null;
}

export interface FacturaCreada {
  id: string;
  invoiceNumber: string;
  subtotal: number;
  discount: number;
  total: number;
  balance: number;
  paid: number;
  status: string;
  appointmentId: string | null;
  items: unknown;
  createdAt: Date;
}

export type ErrorCrearFactura = "invoice_already_exists" | "discount_exceeds_subtotal" | "invoice_number_conflict" | "internal_error";

export interface FacturaExistente {
  id: string;
  invoiceNumber: string;
  total: number;
  balance: number;
  status: string;
}

/**
 * UN SOLO TIPO, sin unión: el repo no compila en `strict` y no estrecha bien
 * por `ok` (mismo criterio que `ResultadoLink` en factura-mp/servicio.server.ts).
 * `ok` decide; los demás campos son null salvo los que aplican a ese caso.
 */
export interface ResultadoCrearFacturaDesdeCita {
  ok: boolean;
  error: ErrorCrearFactura | null;
  invoice: FacturaCreada | null;
  /** Solo con error "invoice_already_exists": la factura que ya existía. */
  existente: FacturaExistente | null;
  /** Lo que se descontó de saldo a favor al crearla (0 = nada, como aplicarSaldoAFavor). */
  anticipoAplicado: number;
  /** Solo con error "internal_error". */
  reason: string | null;
}

function falloFactura(error: ErrorCrearFactura, extra?: Partial<ResultadoCrearFacturaDesdeCita>): ResultadoCrearFacturaDesdeCita {
  return { ok: false, error, invoice: null, existente: null, anticipoAplicado: 0, reason: null, ...extra };
}

export async function crearFacturaDesdeCita(
  args: CrearFacturaDesdeCitaArgs,
): Promise<ResultadoCrearFacturaDesdeCita> {
  const { clinicId, appointmentId, patientId } = args;

  const existing = await prisma.invoice.findUnique({
    where: { appointmentId },
    select: { id: true, invoiceNumber: true, total: true, balance: true, status: true },
  });
  if (existing) return falloFactura("invoice_already_exists", { existente: existing });

  const items = args.lineItems.map((li) => {
    const quantity = li.quantity;
    const unitPrice = round2(li.unitPrice);
    return {
      ...(li.code ? { code: li.code } : {}),
      description: li.description.trim(),
      ...(li.toothNumber != null ? { toothNumber: li.toothNumber } : {}),
      ...(li.surface ? { surface: li.surface } : {}),
      quantity,
      unitPrice,
      total: itemLineTotal({ quantity, unitPrice }),
    };
  });

  const subtotal = sumInvoiceItems(items);
  const discount = round2(Math.max(0, args.discount ?? 0));
  if (discount > subtotal) return falloFactura("discount_exceeds_subtotal");

  const clinicTax = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { cfdiTaxMode: true } });
  const { taxRate, taxIncluded } = clinicInvoiceTaxDefaults(clinicTax?.cfdiTaxMode);
  const { total } = computeInvoiceTotal(subtotal, discount, taxRate, taxIncluded);

  try {
    const invoice = await withInvoiceNumberRetry(async () =>
      prisma.invoice.create({
        data: {
          clinicId,
          patientId,
          appointmentId,
          invoiceNumber: await nextInvoiceNumber(clinicId),
          items: items as unknown as Prisma.InputJsonValue,
          subtotal,
          discount,
          total,
          balance: total,
          status: "PENDING",
          notes: args.notes ?? null,
          taxRate,
          taxIncluded,
        },
        select: {
          id: true, invoiceNumber: true, subtotal: true, discount: true, total: true, balance: true,
          status: true, appointmentId: true, items: true, createdAt: true,
        },
      }),
    );
    // Saldo a favor del paciente (anticipo del bot): la factura nace con él ya
    // descontado, como en POST /api/invoices/from-appointment.
    const saldo = await aplicarSaldoAFavor({ clinicId, invoiceId: invoice.id, userId: args.userId ?? null, origen: "creada" });
    return {
      ok: true,
      error: null,
      existente: null,
      reason: null,
      invoice: saldo.factura
        ? { ...invoice, paid: saldo.factura.paid, balance: saldo.factura.balance, status: saldo.factura.status as unknown as string }
        : { ...invoice, paid: 0 },
      anticipoAplicado: saldo.aplicado,
    };
  } catch (err) {
    if (err instanceof InvoiceNumberExhaustedError) return falloFactura("invoice_number_conflict");
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      const ya = await prisma.invoice.findUnique({
        where: { appointmentId },
        select: { id: true, invoiceNumber: true, total: true, balance: true, status: true },
      });
      if (ya) return falloFactura("invoice_already_exists", { existente: ya });
    }
    return falloFactura("internal_error", { reason: err instanceof Error ? err.message : "unknown" });
  }
}
