// Cancelar una cita cuya factura tiene dinero pagado (H15, opción A — ws1-t4).
// Reglas y porqué en `cita-cancelada-core.ts`.
//
// Sin "server-only" a propósito (mismo criterio que crear-desde-cita.server.ts):
// lo importan rutas cuyos tests cargan con tsx.
//
// `clinicId`, quién y su permiso salen SIEMPRE de la sesión (quien llama).
// Todo lo que toca dinero va en UNA transacción con el candado de la factura
// (el mismo FOR UPDATE que el cobro, el reembolso y /cancel) y, si mueve saldo
// a favor, con el candado del saldo del paciente.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/invoice-totals";
import { logAudit } from "@/lib/audit";
import { algunPagoTieneCfdiVigente } from "@/lib/invoices/cfdi-pago-db";
import { anticipoDeLaFactura } from "@/lib/patient-credit-aplicar";
import { FUENTE_DEVUELTO, claveCandadoSaldo } from "@/lib/patient-credit-core";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";
import { cerrarAnticiposDePanel } from "./panel.server";
import {
  lineaDeMarca,
  motivoParaNoDejarAFavor,
  ultimaMarca,
  type DecisionCitaCancelada,
} from "./cita-cancelada-core";

type Tx = Prisma.TransactionClient;

/** source de la fila POSITIVA de patient_credits: lo pagado de una cita cancelada pasa a favor. */
export const FUENTE_CITA_CANCELADA = "cita_cancelada";

export interface DineroDeCita {
  facturaId: string;
  numero: string;
  pagado: number;
  marca: DecisionCitaCancelada | null;
  /** null = se puede dejar a favor ahora. */
  motivoNoAFavor: string | null;
}

/** Efectivo de la factura cobrado dentro del turno de caja que sigue abierto. */
async function efectivoEnTurnoAbierto(db: Tx | typeof prisma, clinicId: string, invoiceId: string): Promise<number> {
  const turno = await db.cashRegister.findFirst({
    where: { clinicId, status: "OPEN" },
    select: { openedAt: true },
    orderBy: { openedAt: "desc" },
  });
  if (!turno) return 0;
  const agg = await db.payment.aggregate({
    where: { invoiceId, method: "cash", paidAt: { gte: turno.openedAt }, amount: { gt: 0 } },
    _sum: { amount: true },
  });
  return round2(agg._sum.amount ?? 0);
}

async function motivoNoAFavorDe(
  db: Tx | typeof prisma,
  clinicId: string,
  inv: { id: string; cfdiUuid: string | null },
): Promise<string | null> {
  return motivoParaNoDejarAFavor({
    timbrada: !!inv.cfdiUuid,
    cfdiPorPago: await algunPagoTieneCfdiVigente(db as Tx, { clinicId, invoiceId: inv.id }),
    efectivoEnTurnoAbierto: await efectivoEnTurnoAbierto(db, clinicId, inv.id),
  });
}

/**
 * El dinero pagado de la factura VIVA de una cita (una cancelada no cuenta).
 * null si la cita no tiene factura o no tiene nada pagado.
 */
export async function dineroDeLaCita(clinicId: string, appointmentId: string): Promise<DineroDeCita | null> {
  if (!clinicId || !appointmentId) return null;
  const inv = await prisma.invoice.findFirst({
    where: { appointmentId, clinicId, status: { not: "CANCELLED" } },
    select: { id: true, invoiceNumber: true, paid: true, notes: true, cfdiUuid: true },
  });
  if (!inv || !(inv.paid > 0)) return null;
  return {
    facturaId: inv.id,
    numero: inv.invoiceNumber,
    pagado: round2(inv.paid),
    marca: ultimaMarca(inv.notes),
    motivoNoAFavor: await motivoNoAFavorDe(prisma, clinicId, inv),
  };
}

export interface ResultadoDecision {
  ok: boolean;
  /** La decisión que quedó aplicada (puede ser «pendiente» si la pedida no se pudo). */
  aplicada: DecisionCitaCancelada | null;
  monto: number;
  motivo: string | null;
}

/**
 * Aplica la decisión sobre el dinero de una factura cuya cita está cancelada.
 * Idempotente: una marca igual a la que ya tiene no se repite, y «pendiente»
 * nunca pisa una decisión ya tomada. «a_favor» que no se puede ahora (ver
 * `motivoParaNoDejarAFavor`) devuelve ok:false y NO toca nada: quien llama
 * decide si deja la marca «pendiente».
 */
export async function decidirDineroDeCitaCancelada(args: {
  clinicId: string;
  invoiceId: string;
  decision: DecisionCitaCancelada;
  userId: string | null;
  quien: string;
}): Promise<ResultadoDecision> {
  const { clinicId, invoiceId, decision } = args;
  const ahora = new Date();
  if (!clinicId || !invoiceId) return { ok: false, aplicada: null, monto: 0, motivo: "Faltan datos." };

  const r = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} AND "clinicId" = ${clinicId} FOR UPDATE`;
    const inv = await tx.invoice.findFirst({
      where: { id: invoiceId, clinicId },
      select: {
        id: true, patientId: true, invoiceNumber: true, total: true, paid: true,
        status: true, notes: true, cfdiUuid: true, appointmentId: true,
      },
    });
    if (!inv) return { ok: false, aplicada: null, monto: 0, motivo: "Factura no encontrada." } as ResultadoDecision;
    if (inv.status === "CANCELLED" || !(inv.paid > 0)) {
      return { ok: true, aplicada: null, monto: 0, motivo: "La factura ya no tiene dinero pagado." } as ResultadoDecision;
    }
    if (inv.appointmentId) {
      const cita = await tx.appointment.findFirst({ where: { id: inv.appointmentId, clinicId }, select: { status: true } });
      if (cita && cita.status !== "CANCELLED") {
        return { ok: false, aplicada: null, monto: 0, motivo: "La cita de esta factura no está cancelada." } as ResultadoDecision;
      }
    }
    const monto = round2(inv.paid);
    const previa = ultimaMarca(inv.notes);
    if (decision === "pendiente" && previa && previa !== "pendiente") {
      return { ok: true, aplicada: previa, monto, motivo: null } as ResultadoDecision;
    }
    if (decision !== "a_favor" && previa === decision) {
      return { ok: true, aplicada: decision, monto, motivo: null } as ResultadoDecision;
    }

    const marca = lineaDeMarca({ decision, monto, quien: args.quien, cuando: ahora });
    const notas = inv.notes ? `${inv.notes}\n${marca}` : marca;

    if (decision !== "a_favor") {
      await tx.invoice.updateMany({ where: { id: invoiceId, clinicId }, data: { notes: notas } });
      return { ok: true, aplicada: decision, monto, motivo: null } as ResultadoDecision;
    }

    // ── a_favor: el dinero sale de la factura al saldo a favor del paciente ──
    const bloqueo = await motivoNoAFavorDe(tx, clinicId, inv);
    if (bloqueo) return { ok: false, aplicada: null, monto, motivo: bloqueo } as ResultadoDecision;

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claveCandadoSaldo(clinicId, inv.patientId)}))`;
    // Lo que ya era saldo a favor aplicado vuelve con su fila espejo (una
    // aplicación se devuelve una sola vez: `reversesId` es único); el resto
    // (anticipo cobrado en caja, transferencia, Mercado Pago…) entra como
    // fila nueva. Las dos suman exactamente lo pagado.
    const ant = await anticipoDeLaFactura(tx, clinicId, invoiceId);
    const devueltoAplicado = ant.aplicacionId ? round2(Math.min(Math.max(0, ant.neto), monto)) : 0;
    const resto = round2(monto - devueltoAplicado);
    if (devueltoAplicado > 0) {
      await tx.patientCredit.create({
        data: {
          clinicId, patientId: inv.patientId, amount: devueltoAplicado, source: FUENTE_DEVUELTO,
          invoiceId, reversesId: ant.aplicacionId, createdById: args.userId, creditDate: ahora,
          description: `Devuelto a favor: se canceló la cita de la factura ${inv.invoiceNumber}`,
        },
      });
    }
    if (resto > 0) {
      await tx.patientCredit.create({
        data: {
          clinicId, patientId: inv.patientId, amount: resto, source: FUENTE_CITA_CANCELADA,
          invoiceId, createdById: args.userId, creditDate: ahora,
          description: `Pagado de la factura ${inv.invoiceNumber}: se canceló su cita y queda a favor para la próxima`,
        },
      });
    }
    await tx.payment.create({
      data: {
        invoiceId, amount: monto, method: "refund", paidAt: ahora,
        notes: `Pasa al saldo a favor del paciente: se canceló la cita (${args.quien}).`,
      },
    });
    await tx.invoice.updateMany({
      where: { id: invoiceId, clinicId },
      data: { status: "CANCELLED", paid: 0, balance: round2(inv.total), paidAt: null, notes: notas },
    });
    return { ok: true, aplicada: "a_favor", monto, motivo: null } as ResultadoDecision;
  });

  if (r.ok && r.aplicada === decision && r.monto > 0 && args.userId) {
    await logAudit({
      clinicId, userId: args.userId, entityType: "invoice", entityId: invoiceId, action: "update",
      changes: { dineroCitaCancelada: { before: null, after: { decision, monto: r.monto, quien: args.quien } } },
    });
  }
  if (r.ok && r.aplicada === "a_favor" && decision === "a_favor") {
    // Links de pago y anticipos pendientes de una factura cancelada ya no
    // tienen sentido. Nunca lanzan.
    await cerrarLinksDeFactura({ clinicId, invoiceId }).catch(() => {});
    await cerrarAnticiposDePanel({ clinicId, invoiceId }).catch(() => {});
  }
  return r;
}

/**
 * Tras cancelar una cita por un camino SIN decisión (portal, WhatsApp, enlace
 * público, agenda vieja…): si su factura tiene dinero, deja la marca
 * «pendiente de decidir». Nunca lanza: la cita ya está cancelada pase lo que
 * pase aquí.
 */
export async function marcarPendienteSiHayDinero(args: {
  clinicId: string;
  appointmentId: string;
  userId?: string | null;
  quien: string;
}): Promise<void> {
  try {
    const d = await dineroDeLaCita(args.clinicId, args.appointmentId);
    if (!d) return;
    await decidirDineroDeCitaCancelada({
      clinicId: args.clinicId, invoiceId: d.facturaId, decision: "pendiente", userId: args.userId ?? null, quien: args.quien,
    });
  } catch (e) {
    console.error("[anticipos:cita-cancelada] no se pudo marcar el dinero como pendiente:", e);
  }
}
