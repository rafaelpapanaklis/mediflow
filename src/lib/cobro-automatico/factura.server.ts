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
  /** El Payment de la factura (null si todo quedó a favor). */
  paymentRowId: string | null;
  /** Lo pagado de la factura ANTES de este cobro (para decir qué mensualidad cubrió). */
  pagadoAntes: number;
  /** Lo que entró a la factura. */
  aFactura: number;
  /** Lo que no cabía en la factura y quedó como saldo a favor del paciente (F12). */
  aFavor: number;
  creditoId: string | null;
  /** null = normal. Texto = algo que recepción debe revisar (dinero a favor, factura cancelada…). */
  anomalia: string | null;
}

/** source de la fila positiva de patient_credits que deja un cobro automático que no cabía en la factura. */
export const FUENTE_COBRO_AUTOMATICO = "cobro_automatico_mercadopago";

/** La descripción de esa fila: lleva el id del pago de MP (con ella se evita crearla dos veces). */
export function descripcionDelCredito(pagoMp: string, folio: string, porque: string): string {
  return `Cobro automático con tarjeta (pago MP ${pagoMp}) de la factura ${folio}: ${porque}. Queda a favor del paciente.`;
}

/**
 * Registra UN cobro aprobado. Idempotente por el id del pago de MP, bajo el
 * `FOR UPDATE` de la factura (el mismo candado del cobro en caja, mark-paid y el
 * portal).
 *
 * F12 (auditoría de dinero, 3-oct-2026): lo que NO cabe en la factura ya no se
 * queda «⚠️ revisar/devolver» con `paid > total`:
 *   · factura cancelada o ya pagada → TODO el cobro pasa a saldo a favor del
 *     paciente (patient_credits) y la factura no se toca;
 *   · cobro mayor que lo que falta → a la factura lo que falta (la deja PAID) y
 *     el resto a saldo a favor.
 * Recepción lo ve en Caja («cobros automáticos por revisar»): ahí decide si lo
 * deja a favor o lo devuelve. Sin paciente en la factura (no debería pasar) se
 * registra como antes, marcado.
 */
export async function registrarCobroEnFactura(
  db: Db,
  a: { clinicId: string; invoiceId: string; monto: number; referencia: string; pagadoEl: Date; nota: string },
): Promise<ResultadoRegistro> {
  const nada = (pagadoAntes = 0, paymentRowId: string | null = null): ResultadoRegistro =>
    ({ aplicado: false, paymentRowId, pagadoAntes, aFactura: 0, aFavor: 0, creditoId: null, anomalia: null });
  if (!a.clinicId || !a.invoiceId || !a.referencia) return nada();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${a.invoiceId} FOR UPDATE`;

    const inv = await tx.invoice.findFirst({
      where: { id: a.invoiceId, clinicId: a.clinicId },
      select: { id: true, total: true, paid: true, status: true, patientId: true, invoiceNumber: true },
    });
    if (!inv) return nada();
    const pagadoAntes = Number(inv.paid) || 0;

    const ya = await tx.payment.findFirst({
      where: { invoiceId: a.invoiceId, method: METODO_MERCADO_PAGO, reference: a.referencia },
      select: { id: true },
    });
    if (ya) return nada(pagadoAntes, ya.id);

    const montoC = aCentavos(a.monto);
    const pendienteC = Math.max(0, aCentavos(inv.total) - aCentavos(pagadoAntes));
    const cancelada = inv.status === "CANCELLED";
    const aFacturaC = cancelada ? 0 : Math.min(montoC, pendienteC);
    const aFavorC = montoC - aFacturaC;
    const porque = cancelada ? "la factura está cancelada" : pendienteC <= 0 ? "la factura ya estaba pagada" : `excedía lo que faltaba ($${aPesos(pendienteC).toFixed(2)})`;

    if (aFavorC > 0 && !inv.patientId) {
      // Sin paciente no hay a quién dejarle el saldo: se registra marcado, como antes.
      const anomalia = `Cobro automático de Mercado Pago recibido y ${porque} — revisar/devolver`;
      const p = await tx.payment.create({
        data: { invoiceId: inv.id, amount: aPesos(montoC), method: METODO_MERCADO_PAGO, reference: a.referencia, paidAt: a.pagadoEl, notes: `⚠️ ${anomalia}` },
        select: { id: true },
      });
      return { aplicado: true, paymentRowId: p.id, pagadoAntes, aFactura: 0, aFavor: 0, creditoId: null, anomalia };
    }

    const descripcion = descripcionDelCredito(a.referencia, inv.invoiceNumber, porque);
    if (aFavorC > 0) {
      // Todo a favor y ya registrado (un reintento del aviso): no se crea otra fila.
      const credito = await tx.patientCredit.findFirst({
        where: { clinicId: a.clinicId, patientId: inv.patientId as string, source: FUENTE_COBRO_AUTOMATICO, description: descripcion },
        select: { id: true },
      });
      if (credito) return { ...nada(pagadoAntes), creditoId: credito.id };
    }

    let paymentRowId: string | null = null;
    if (aFacturaC > 0) {
      const nuevoPagadoC = aCentavos(pagadoAntes) + aFacturaC;
      const saldada = nuevoPagadoC >= aCentavos(inv.total);
      const p = await tx.payment.create({
        data: {
          invoiceId: inv.id,
          amount: aPesos(aFacturaC),
          method: METODO_MERCADO_PAGO,
          reference: a.referencia,
          paidAt: a.pagadoEl,
          notes: aFavorC > 0 ? `${a.nota} · $${aPesos(aFavorC).toFixed(2)} de este cobro quedaron a favor del paciente` : a.nota,
        },
        select: { id: true },
      });
      paymentRowId = p.id;
      await tx.invoice.updateMany({
        where: { id: inv.id, clinicId: a.clinicId },
        data: {
          paid: aPesos(nuevoPagadoC),
          balance: aPesos(Math.max(0, aCentavos(inv.total) - nuevoPagadoC)),
          status: saldada ? "PAID" : "PARTIAL",
          paymentMethod: METODO_MERCADO_PAGO,
          ...(saldada ? { paidAt: a.pagadoEl } : {}),
        },
      });
    }

    let creditoId: string | null = null;
    if (aFavorC > 0) {
      const c = await tx.patientCredit.create({
        data: {
          clinicId: a.clinicId,
          patientId: inv.patientId as string,
          amount: aPesos(aFavorC),
          source: FUENTE_COBRO_AUTOMATICO,
          creditDate: a.pagadoEl,
          description: descripcion,
        },
        select: { id: true },
      });
      creditoId = c.id;
    }
    const anomalia = aFavorC > 0
      ? `$${aPesos(aFavorC).toFixed(2)} del cobro automático quedaron a favor del paciente: ${porque}. Revisa si se deja a favor o se devuelve.`
      : null;
    return { aplicado: true, paymentRowId, pagadoAntes, aFactura: aPesos(aFacturaC), aFavor: aPesos(aFavorC), creditoId, anomalia };
  });
}
