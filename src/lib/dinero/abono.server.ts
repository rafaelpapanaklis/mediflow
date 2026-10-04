import "server-only";
// ═══════════════════════════════════════════════════════════════════════════
// «Abonar a otra factura»: el servidor (decisión de Rafael, 4-oct-2026). Las
// reglas del reparto, en abono-core.ts.
//
// UN cobro de dinero real se registra como un Payment POR FACTURA, todos con el
// método real y la misma fecha (así el arqueo de Caja cuadra con el cajón y
// Finanzas cuenta el ingreso una sola vez: la suma de las partes es el cobro).
// Las notas de los Payment llevan el mismo «cobro #…» para ligarlos. Lo que
// sobre después de la factura elegida va a favor del paciente con el MISMO
// trío que ya usa el excedente de ortodoncia (Payment real + traspaso «refund
// saldo_a_favor», que no es reembolso, + fila del libro `excedente_de_cobro`).
//
// clinicId SIEMPRE de la sesión. Las dos facturas, del MISMO paciente.
// Todo en UNA transacción con el candado de fila de las dos (orden por id).
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/invoice-totals";
import { FUENTE_EXCEDENTE } from "@/lib/patient-credit-core";
import { REEMBOLSO_A_SALDO_A_FAVOR } from "@/lib/dinero/reembolsos";
import { ESTADOS_ABONABLES, facturasAbonables, notasDelAbono, repartirConAbono, type FacturaAbonable, type RepartoConAbono } from "./abono-core";

type Db = Pick<typeof prisma, "$transaction" | "invoice">;
type Tx = Prisma.TransactionClient;

/** Las demás facturas del paciente con saldo (para la lista «Abonar a…»). */
export async function abonablesDelPaciente(clinicId: string, patientId: string, excluirId: string | null, db: Pick<typeof prisma, "invoice"> = prisma): Promise<FacturaAbonable[]> {
  if (!clinicId || !patientId) return [];
  const filas = await db.invoice.findMany({
    where: { clinicId, patientId, status: { in: [...ESTADOS_ABONABLES] } },
    select: { id: true, invoiceNumber: true, status: true, total: true, paid: true, items: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return facturasAbonables(filas, excluirId);
}

export interface ArgsCobroConAbono {
  clinicId: string;
  userId: string;
  /** La factura que se está cobrando. */
  invoiceId: string;
  /** La factura a la que va lo de más. null = lo de más queda a favor. */
  destinoId: string | null;
  amount: number;
  method: string;
  paidAt: Date;
  reference?: string | null;
  notes?: string | null;
  /** «Efectivo sin caja abierta» (lo calcula la ruta, como el cobro de siempre). */
  avisoDeCaja?: string | null;
}

export interface FacturaTocadaAbono {
  invoiceId: string;
  invoiceNumber: string;
  monto: number;
  antes: { paid: number; balance: number; status: string };
  despues: { paid: number; balance: number; status: string };
}

export type ResultadoCobroConAbono =
  | { ok: true; cobroId: string; patientId: string; reparto: RepartoConAbono; facturas: FacturaTocadaAbono[]; folioCobrada: string; folioDestino: string | null }
  | { ok: false; error: string; status: number };

const nota = (base: string, args: ArgsCobroConAbono) =>
  [base, args.notes || null, args.avisoDeCaja ? `⚠️ ${args.avisoDeCaja}` : null].filter(Boolean).join(" · ");

export async function cobrarConAbono(args: ArgsCobroConAbono, db: Db = prisma): Promise<ResultadoCobroConAbono> {
  if (!args.clinicId || !args.invoiceId) return { ok: false, error: "Faltan datos", status: 400 };
  if (args.destinoId && args.destinoId === args.invoiceId) return { ok: false, error: "Elige OTRA factura para abonar", status: 400 };
  const monto = round2(Number(args.amount));
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: "El monto debe ser mayor a 0", status: 400 };
  return db.$transaction((tx) => enTx(tx as Tx, { ...args, amount: monto }), { timeout: 15_000, maxWait: 5_000 });
}

async function enTx(tx: Tx, args: ArgsCobroConAbono): Promise<ResultadoCobroConAbono> {
  const { clinicId } = args;
  const ids = Array.from(new Set([args.invoiceId, ...(args.destinoId ? [args.destinoId] : [])])).sort();
  // El candado de siempre (cobro, mark-paid, reembolso, cancelar), en orden de id.
  await tx.$queryRaw`SELECT id FROM invoices WHERE id IN (${Prisma.join(ids)}) AND "clinicId" = ${clinicId} ORDER BY id FOR UPDATE`;
  const filas = await tx.invoice.findMany({
    where: { id: { in: ids }, clinicId },
    select: { id: true, invoiceNumber: true, patientId: true, total: true, paid: true, balance: true, status: true },
  });
  const cobrada = filas.find((f) => f.id === args.invoiceId);
  if (!cobrada) return { ok: false, error: "Not found", status: 404 };
  if (cobrada.status === "DRAFT") return { ok: false, error: "Confirma la factura antes de registrar pagos", status: 400 };
  if (cobrada.status === "CANCELLED") return { ok: false, error: "Esta factura está cancelada", status: 400 };
  if (!cobrada.patientId) return { ok: false, error: "La factura no tiene paciente: no hay a dónde abonar", status: 400 };

  let destino: (typeof filas)[number] | null = null;
  if (args.destinoId) {
    destino = filas.find((f) => f.id === args.destinoId) ?? null;
    if (!destino) return { ok: false, error: "La factura a la que se abona no existe", status: 404 };
    if (destino.patientId !== cobrada.patientId) return { ok: false, error: "Solo se abona a otra factura del MISMO paciente", status: 400 };
    if (!(ESTADOS_ABONABLES as readonly string[]).includes(destino.status)) {
      return { ok: false, error: `La factura ${destino.invoiceNumber} ya no recibe pagos (${destino.status === "PAID" ? "está pagada" : destino.status === "DRAFT" ? "es un borrador" : "está cancelada"})`, status: 409 };
    }
  }

  // Lo que les falta HOY (releído bajo candado), no lo que se vio en pantalla.
  const faltaCobrada = round2(cobrada.total - cobrada.paid);
  const faltaDestino = destino ? round2(destino.total - destino.paid) : null;
  const reparto = repartirConAbono({ monto: args.amount, faltaCobrada, faltaDestino });
  if (reparto.enCobrada <= 0 && reparto.enDestino <= 0) {
    return { ok: false, error: destino ? `La factura ${destino.invoiceNumber} ya no tiene saldo` : "Esta factura ya no tiene saldo pendiente", status: 400 };
  }

  const cobroId = randomUUID().replace(/-/g, "").slice(0, 8);
  const notas = notasDelAbono({ cobroId, monto: args.amount, folioCobrada: cobrada.invoiceNumber, folioDestino: destino?.invoiceNumber ?? null, reparto });
  const facturas: FacturaTocadaAbono[] = [];

  const pagar = async (f: NonNullable<typeof destino>, parte: number, texto: string) => {
    await tx.payment.create({
      data: { invoiceId: f.id, amount: parte, method: args.method, reference: args.reference ?? null, notes: nota(texto, args), paidAt: args.paidAt },
      select: { id: true },
    });
    const paid = round2(f.paid + parte);
    const balance = round2(f.total - paid);
    const status = balance <= 0 ? "PAID" : "PARTIAL";
    await tx.invoice.updateMany({
      where: { id: f.id, clinicId },
      data: { paid, balance: Math.max(0, balance), status: status as any, ...(status === "PAID" ? { paidAt: args.paidAt } : {}), paymentMethod: args.method },
    });
    facturas.push({
      invoiceId: f.id, invoiceNumber: f.invoiceNumber, monto: parte,
      antes: { paid: f.paid, balance: f.balance, status: f.status },
      despues: { paid, balance: Math.max(0, balance), status },
    });
  };

  if (reparto.enCobrada > 0) await pagar(cobrada, reparto.enCobrada, notas.cobrada);
  if (destino && reparto.enDestino > 0) await pagar(destino, reparto.enDestino, notas.destino);

  if (reparto.aFavor > 0) {
    // Lo que sobra: el dinero SÍ entró (Payment con el método real) y en el
    // mismo instante pasa al libro del paciente (traspaso «refund» que no es
    // reembolso). Va en la factura que recibió dinero de este cobro.
    const ancla = reparto.enCobrada > 0 ? cobrada : destino!;
    const excedente = await tx.payment.create({
      data: { invoiceId: ancla.id, amount: reparto.aFavor, method: args.method, reference: args.reference ?? null, notes: nota(notas.aFavor, args), paidAt: args.paidAt },
      select: { id: true },
    });
    await tx.payment.create({
      data: {
        invoiceId: ancla.id,
        amount: reparto.aFavor,
        method: "refund",
        refundMethod: REEMBOLSO_A_SALDO_A_FAVOR,
        notes: `Excedente del cobro #${cobroId}: pasa al saldo a favor del paciente (no sale dinero de caja).`,
        paidAt: args.paidAt,
      },
    });
    await tx.patientCredit.create({
      data: {
        clinicId,
        patientId: cobrada.patientId,
        amount: reparto.aFavor,
        source: FUENTE_EXCEDENTE,
        invoiceId: ancla.id,
        paymentId: excedente.id,
        createdById: args.userId,
        creditDate: args.paidAt,
        description: `Pagado de más al cobrar la factura ${cobrada.invoiceNumber} (cobro #${cobroId})`,
      },
    });
  }

  return { ok: true, cobroId, patientId: cobrada.patientId, reparto, facturas, folioCobrada: cobrada.invoiceNumber, folioDestino: destino?.invoiceNumber ?? null };
}
