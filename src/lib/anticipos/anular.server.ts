import "server-only";
// Anular un anticipo registrado por error (H7 de la revisión final, ws1-t4).
// Las reglas y el porqué, en `anular-core.ts`.
//
// `clinicId`, quien anula y su nombre salen SIEMPRE de la sesión (la ruta).
// Todo en UNA transacción con el candado de la factura (el mismo FOR UPDATE
// que el cobro, el reembolso y el registro del anticipo).

import { prisma } from "@/lib/prisma";
import { algunPagoTieneCfdiVigente } from "@/lib/invoices/cfdi-pago-db";
import {
  ESTADO_MP_ANULADO,
  facturaTrasAnular,
  notaDeAnulacion,
  pagoSumoALaFactura,
  validarMotivoAnulacion,
} from "./anular-core";

export interface AnticipoAnulable {
  depositId: string;
  paymentId: string;
  monto: number;
  method: string;
  paidAt: string | null;
  porMercadoPago: boolean;
}

/** Los anticipos recibidos de la factura que todavía se pueden anular. */
export async function anticiposAnulables(clinicId: string, invoiceId: string): Promise<AnticipoAnulable[]> {
  if (!clinicId || !invoiceId) return [];
  try {
    const depositos = await prisma.appointmentDeposit.findMany({
      where: { clinicId, invoiceId, status: "PAID", paymentId: { not: null } },
      select: { id: true, paymentId: true, method: true },
      orderBy: { paidAt: "desc" },
      take: 20,
    });
    if (depositos.length === 0) return [];
    const pagos = await prisma.payment.findMany({
      where: { invoiceId, id: { in: depositos.map((d) => d.paymentId!) }, amount: { gt: 0 } },
      select: { id: true, amount: true, method: true, paidAt: true },
    });
    const porId = new Map(pagos.map((p) => [p.id, p]));
    return depositos.flatMap((d) => {
      const p = porId.get(d.paymentId!);
      if (!p) return [];
      return [{
        depositId: d.id,
        paymentId: p.id,
        monto: p.amount,
        method: p.method,
        paidAt: p.paidAt ? p.paidAt.toISOString() : null,
        porMercadoPago: d.method === "mercadopago" || p.method === "mercadopago",
      }];
    });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022") return [];
    throw e;
  }
}

export type ErrorAnular = "no_encontrada" | "estado" | "cfdi" | "no_anulable" | "motivo";

export interface ResultadoAnular {
  ok: boolean;
  error: ErrorAnular | null;
  motivo: string | null;
  anulado: {
    monto: number;
    method: string;
    porMercadoPago: boolean;
    antes: { paid: number; balance: number; status: string };
    despues: { paid: number; balance: number; status: string };
  } | null;
}

function falla(error: ErrorAnular, motivo: string): ResultadoAnular {
  return { ok: false, error, motivo, anulado: null };
}

export async function anularAnticipoRecibido(args: {
  clinicId: string;
  invoiceId: string;
  depositId: string;
  userId: string;
  quien: string;
  motivo: string;
}): Promise<ResultadoAnular> {
  const { clinicId, invoiceId, depositId } = args;
  if (!clinicId || !invoiceId || !depositId || !args.userId) return falla("no_encontrada", "Faltan datos.");
  const errMotivo = validarMotivoAnulacion(args.motivo);
  if (errMotivo) return falla("motivo", errMotivo);
  const ahora = new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findFirst({
      where: { id: invoiceId, clinicId },
      select: { id: true, total: true, paid: true, balance: true, status: true, cfdiUuid: true },
    });
    if (!inv) return falla("no_encontrada", "Factura no encontrada.");
    if (inv.status === "CANCELLED") return falla("estado", "La factura está cancelada.");
    if (inv.cfdiUuid) {
      return falla("cfdi", "La factura ya está timbrada: cancela primero el CFDI ante el SAT; anular el anticipo lo dejaría vigente por un pago que ya no existe.");
    }
    if (await algunPagoTieneCfdiVigente(tx, { clinicId, invoiceId })) {
      return falla("cfdi", "Esta factura tiene pagos con su propio CFDI timbrado: anular el anticipo lo dejaría vigente. Escríbenos a soporte con el folio.");
    }

    const dep = await tx.appointmentDeposit.findFirst({
      where: { id: depositId, clinicId, invoiceId, status: "PAID" },
      select: { id: true, paymentId: true, method: true },
    });
    if (!dep?.paymentId) return falla("no_anulable", "Ese anticipo ya no se puede anular (ya se anuló o no está cobrado).");
    const pago = await tx.payment.findFirst({
      where: { id: dep.paymentId, invoiceId },
      select: { id: true, amount: true, method: true, notes: true },
    });
    if (!pago || !(pago.amount > 0)) return falla("no_anulable", "Ese anticipo ya no tiene un pago que anular.");

    const resta = pagoSumoALaFactura(pago.notes) ? pago.amount : 0;
    if (resta > inv.paid + 0.01) {
      return falla("no_anulable", "Lo pagado de la factura no cuadra con ese anticipo: revísalo con soporte antes de anularlo.");
    }
    const nota = notaDeAnulacion({ monto: pago.amount, method: pago.method, quien: args.quien, cuando: ahora, motivo: args.motivo });

    await tx.payment.update({
      where: { id: pago.id },
      data: { amount: 0, notes: pago.notes ? `${pago.notes} ${nota}` : nota },
    });
    await tx.appointmentDeposit.update({
      where: { id: dep.id },
      data: { status: "FAILED", lastMpStatus: ESTADO_MP_ANULADO, lastMpStatusDetail: nota.slice(0, 500) },
    });
    const despues = facturaTrasAnular(inv.total, inv.paid, resta);
    await tx.invoice.updateMany({
      where: { id: invoiceId, clinicId },
      data: {
        paid: despues.paid,
        balance: despues.balance,
        status: despues.status,
        ...(despues.status !== "PAID" ? { paidAt: null } : {}),
      },
    });
    return {
      ok: true,
      error: null,
      motivo: null,
      anulado: {
        monto: pago.amount,
        method: pago.method,
        porMercadoPago: dep.method === "mercadopago" || pago.method === "mercadopago",
        antes: { paid: inv.paid, balance: inv.balance, status: inv.status },
        despues,
      },
    };
  });
}
