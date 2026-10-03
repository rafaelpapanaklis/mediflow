// Cobro automático (ws1-t6) — lo que se lee y se escribe de la FACTURA.
//
// Registrar un cobro aprobado es exactamente lo que hace `aplicarPagoDeFactura`
// (factura-mp/servicio.server.ts) con un link: dentro de una transacción con
// `FOR UPDATE` sobre la factura (el mismo candado del cobro en caja, de
// mark-paid y del portal) se busca un Payment previo con la misma referencia
// (el id del pago de MP) y solo si no hay se crea. Idempotente: MP reintenta los
// avisos y el respaldo («sincronizar») puede ver el mismo cobro otra vez.

import { prisma } from "@/lib/prisma";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { aCentavos, aPesos } from "@/lib/quotes/condiciones-pago";
import { METODO_MERCADO_PAGO } from "./core";

type Db = typeof prisma;

export interface DatosFactura {
  id: string;
  clinicId: string;
  invoiceNumber: string;
  status: string;
  total: number;
  paid: number;
  patientId: string | null;
  paciente: { nombre: string; email: string | null; telefono: string | null } | null;
  clinica: { nombre: string; timezone: string };
  condiciones: CondicionesPago | null;
  /** El caso de ortodoncia ligado a la factura (si lo hay). */
  caso: { id: string; status: string } | null;
}

export async function leerFactura(db: Db, clinicId: string, invoiceId: string): Promise<DatosFactura | null> {
  // clinicId vacío no filtra nada (Prisma descarta la clave): se corta antes.
  if (!clinicId || !invoiceId) return null;
  const inv = await db.invoice.findFirst({
    where: { id: invoiceId, clinicId },
    select: {
      id: true, invoiceNumber: true, status: true, total: true, paid: true, patientId: true,
      patient: { select: { firstName: true, lastName: true, email: true, phone: true } },
      clinic: { select: { name: true, timezone: true } },
    },
  });
  if (!inv) return null;
  const [{ porFactura }, caso] = await Promise.all([
    leerCondicionesDeFacturas(db, { clinicId, invoiceIds: [invoiceId] }),
    db.orthodonticTreatmentPlan.findFirst({ where: { invoiceId, clinicId }, select: { id: true, status: true } }),
  ]);
  return {
    id: inv.id,
    clinicId,
    invoiceNumber: inv.invoiceNumber,
    status: String(inv.status),
    total: Number(inv.total) || 0,
    paid: Number(inv.paid) || 0,
    patientId: inv.patientId ?? null,
    paciente: inv.patient
      ? {
          nombre: `${inv.patient.firstName} ${inv.patient.lastName ?? ""}`.trim(),
          email: inv.patient.email ?? null,
          telefono: inv.patient.phone ?? null,
        }
      : null,
    clinica: { nombre: inv.clinic?.name ?? "la clínica", timezone: inv.clinic?.timezone || "America/Mexico_City" },
    condiciones: porFactura.get(invoiceId) ?? null,
    caso: caso ? { id: caso.id, status: String(caso.status) } : null,
  };
}

export interface ResultadoRegistro {
  aplicado: boolean;
  paymentRowId: string | null;
  /** Lo pagado de la factura ANTES de este cobro (para decir qué mensualidad cubrió). */
  pagadoAntes: number;
  /** null = normal. Texto = el Payment quedó marcado para revisar/devolver. */
  anomalia: string | null;
}

/**
 * Registra UN cobro aprobado como Payment `mercadopago` de la factura. Mismo
 * criterio que `aplicarPagoDeFactura`: sobre una factura cancelada o ya saldada
 * el dinero se registra pero la factura no cambia y queda marcado; si pagó de
 * más, entra tal cual y se marca.
 */
export async function registrarCobroEnFactura(
  db: Db,
  a: { clinicId: string; invoiceId: string; monto: number; referencia: string; pagadoEl: Date; nota: string },
): Promise<ResultadoRegistro> {
  if (!a.clinicId || !a.invoiceId || !a.referencia) return { aplicado: false, paymentRowId: null, pagadoAntes: 0, anomalia: null };
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${a.invoiceId} FOR UPDATE`;

    const ya = await tx.payment.findFirst({
      where: { invoiceId: a.invoiceId, method: METODO_MERCADO_PAGO, reference: a.referencia },
      select: { id: true },
    });
    const inv = await tx.invoice.findFirst({
      where: { id: a.invoiceId, clinicId: a.clinicId },
      select: { id: true, total: true, paid: true, status: true },
    });
    if (!inv) return { aplicado: false, paymentRowId: null, pagadoAntes: 0, anomalia: null };
    const pagadoAntes = Number(inv.paid) || 0;
    if (ya) return { aplicado: false, paymentRowId: ya.id, pagadoAntes, anomalia: null };

    const monto = aPesos(aCentavos(a.monto));
    const pendiente = aPesos(Math.max(0, aCentavos(inv.total) - aCentavos(pagadoAntes)));
    const raro = inv.status === "CANCELLED" ? "factura cancelada" : pendiente <= 0 ? "factura ya saldada" : null;

    if (raro) {
      const anomalia = `Cobro automático de Mercado Pago recibido sobre ${raro} — revisar/devolver`;
      const p = await tx.payment.create({
        data: { invoiceId: inv.id, amount: monto, method: METODO_MERCADO_PAGO, reference: a.referencia, paidAt: a.pagadoEl, notes: `⚠️ ${anomalia}` },
        select: { id: true },
      });
      return { aplicado: true, paymentRowId: p.id, pagadoAntes, anomalia };
    }

    const nuevoPagado = aPesos(aCentavos(pagadoAntes) + aCentavos(monto));
    const nuevoSaldo = aPesos(Math.max(0, aCentavos(inv.total) - aCentavos(nuevoPagado)));
    const saldada = nuevoSaldo <= 0;
    const excedente = aPesos(aCentavos(nuevoPagado) - aCentavos(inv.total));
    const anomalia = excedente > 0 ? `Cobro automático de Mercado Pago con excedente de $${excedente.toFixed(2)} sobre el saldo — revisar/devolver` : null;
    const p = await tx.payment.create({
      data: {
        invoiceId: inv.id,
        amount: monto,
        method: METODO_MERCADO_PAGO,
        reference: a.referencia,
        paidAt: a.pagadoEl,
        notes: anomalia ? `⚠️ ${anomalia}` : a.nota,
      },
      select: { id: true },
    });
    await tx.invoice.updateMany({
      where: { id: inv.id, clinicId: a.clinicId },
      data: {
        paid: nuevoPagado,
        balance: nuevoSaldo,
        status: saldada ? "PAID" : "PARTIAL",
        paymentMethod: METODO_MERCADO_PAGO,
        ...(saldada ? { paidAt: a.pagadoEl } : {}),
      },
    });
    return { aplicado: true, paymentRowId: p.id, pagadoAntes, anomalia };
  });
}
