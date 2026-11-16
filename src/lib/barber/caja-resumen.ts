// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — RESUMEN DE CAJA, función PURA (ws6-t1, 16-nov-2026).
//
// UNA sola función (cajaResumen) que, de los tickets (los anticipos y sus
// devoluciones también son tickets: «ticket de mostrador», ver cash.ts) y de
// los movimientos de caja (sql/barber_caja_completa.sql), da el resumen de un
// periodo: un turno de caja, un día o un mes. La usan Caja (tarjetas, corte,
// impreso, CSV) y, encima de este archivo, Inicio y Reportes.
//
// Y UNA sola fórmula del efectivo esperado (esperadoEnEfectivo), la de
// siempre extendida:
//
//   ESPERADO = fondo
//            + efectivo cobrado        (tickets en efectivo, propinas incluidas)
//            + entradas de efectivo    (DEPOSIT)
//            − gastos en efectivo      (EXPENSE, method CASH)
//            − retiros                 (WITHDRAWAL, siempre efectivo)
//            − pagos a barberos en efectivo (BARBER_PAYOUT, method CASH)
//            − anticipos devueltos en efectivo (ticket negativo «refund»)
//
// Sin movimientos es EXACTAMENTE la de antes: fondo + Σ total de los tickets
// en efectivo (la devolución ya era un ticket negativo en efectivo; aquí solo
// se enseña aparte). expectedCashFor de cash.ts llama a esta misma función.
//
// Reglas:
//  · Los tickets cancelados y los movimientos anulados NO cuentan.
//  · Dinero en Prisma.Decimal; redondeo ÚNICO a centavos al final (half-up).
//    Los números que salen son para JSON (2 decimales).
//  · Sin prisma, sin "server-only": se prueba con tsx a secas. NO lo importes
//    desde un componente "use client" (arrastra Decimal): la pantalla recibe
//    el resultado ya calculado. Lo client-safe está en caja-movimientos-core.ts.
//
// ⚠️ CONTRATO (otra pantalla construye Inicio y Reportes encima): no cambies
// la firma de cajaResumen / esperadoEnEfectivo / los tipos exportados sin
// anotarlo en el reporte de ws6-t1. Agregar campos opcionales sí se vale.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { isDepositLine, isDepositRefundLine } from "@/lib/barber/memberships-core";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import {
  BARBER_PAYOUT_KINDS,
  CASH_MOVEMENT_METHODS,
  type BarberPayoutKind,
  type CashMovementMethod,
  type CashMovementType,
} from "@/lib/barber/caja-movimientos-core";

type Dec = Prisma.Decimal;
type MoneyIn = Prisma.Decimal | number | string | null | undefined;

const ROUND = Prisma.Decimal.ROUND_HALF_UP;
const Z = (): Dec => new Prisma.Decimal(0);

function D(v: MoneyIn): Dec {
  if (v === null || v === undefined || v === "") return Z();
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}
function out(v: Dec): number {
  return v.toDecimalPlaces(2, ROUND).toNumber();
}

// ── Entrada ─────────────────────────────────────────────────────────────

/** De qué es el ticket (memberships-core.saleKindOf). */
export type ResumenTicketKind = "sale" | "membership" | "deposit" | "refund";

/** Lo mínimo de un ticket (SaleRow de cash.ts lo cumple, más `discount`). */
export interface ResumenTicket {
  paymentMethod: BarberPaymentMethod;
  subtotal: MoneyIn;
  tip: MoneyIn;
  total: MoneyIn;
  cancelled: boolean;
  kind: ResumenTicketKind;
  barberId: string | null;
  barberName?: string | null;
  /** Descuento del ticket (positivo). Sin él, se deriva de `items` si vienen. */
  discount?: MoneyIn;
  items?: Array<{ description: string; qty: number; unitPrice: MoneyIn }>;
}

/** Lo mínimo de un movimiento de caja (CashMovementRow de cash-movements.ts lo cumple). */
export interface ResumenMovement {
  type: CashMovementType;
  method: CashMovementMethod;
  amount: MoneyIn;
  category: string | null;
  barberId: string | null;
  barberName?: string | null;
  payoutKind: BarberPayoutKind | null;
  /** Anulado = no cuenta (se acepta la fecha o un booleano). */
  voided?: boolean;
  voidedAt?: string | Date | null;
}

export interface ResumenInput {
  /** Fondo con el que se abrió el turno. null/0 = sin fondo (resumen de un día o un mes). */
  openingAmount: MoneyIn;
  tickets: ResumenTicket[];
  movements: ResumenMovement[];
}

// ── Salida (números listos para JSON) ───────────────────────────────────

/** Medio de cobro como se enseña: STRIPE es «en línea» (Mercado Pago / tarjeta en línea). */
export type ResumenIncomeMethod = "CASH" | "CARD" | "SPEI" | "ONLINE";
export const RESUMEN_INCOME_METHODS: ResumenIncomeMethod[] = ["CASH", "CARD", "SPEI", "ONLINE"];

export interface CountTotal {
  count: number;
  total: number;
}

/** El esperado en efectivo, desglosado como se imprime en el corte. */
export interface EsperadoDesglose {
  opening: number;
  /** + efectivo cobrado (tickets en efectivo, propinas incluidas; sin devoluciones). */
  cashCharged: number;
  cashTickets: number;
  /** Parte de cashCharged que son propinas (nota, no se suma aparte). */
  cashTipsIncluded: number;
  /** + entradas de efectivo. */
  cashIn: number;
  /** − gastos pagados en efectivo. */
  cashExpenses: number;
  /** − retiros. */
  withdrawals: number;
  /** − pagos a barberos en efectivo. */
  cashPayouts: number;
  /** − anticipos devueltos en efectivo. */
  cashRefunds: number;
  /** = lo que debe haber en el cajón. */
  expected: number;
}

export interface ResumenBarbero {
  barberId: string;
  barberName: string;
  /** Tickets de venta (visitas) atendidos. */
  tickets: number;
  /** Σ subtotal (sin propina) de sus tickets. */
  produced: number;
  tips: number;
  /** Lo que se le pagó en el periodo (todos los medios). */
  paidOut: number;
}

export interface CajaResumen {
  opening: number;
  income: {
    /** Todo lo cobrado (tickets vivos, propinas incluidas, menos devoluciones de anticipo). */
    total: number;
    /** Por medio de cobro (las devoluciones restan en su medio). */
    byMethod: Record<ResumenIncomeMethod, CountTotal>;
    /** Por tipo de ticket: venta (servicios/productos), membresía, anticipo, devolución (negativa). */
    byKind: Record<ResumenTicketKind, CountTotal>;
    /** Σ subtotal de los tickets de venta (sin propinas). */
    sales: number;
  };
  tips: { total: number; cash: number; byBarber: Array<{ barberId: string; barberName: string; total: number }> };
  discounts: number;
  tickets: {
    /** Tickets de VENTA vivos (las membresías y anticipos de mostrador van en income.byKind). */
    count: number;
    cancelled: number;
    /** Σ subtotal de venta / count (sin propina). 0 si no hay tickets. */
    average: number;
  };
  byBarber: ResumenBarbero[];
  expenses: {
    total: number;
    count: number;
    /** Solo lo pagado en efectivo (sale del cajón). */
    cash: number;
    byCategory: Array<{ category: string; count: number; total: number }>;
    byMethod: Record<CashMovementMethod, number>;
  };
  withdrawals: CountTotal;
  deposits: CountTotal;
  payouts: {
    total: number;
    count: number;
    cash: number;
    byKind: Record<BarberPayoutKind, number>;
  };
  /** Anticipos devueltos (todos los medios; el efectivo también va en el desglose). */
  refunds: CountTotal;
  voidedMovements: number;
  /** El esperado y cómo se llega a él. */
  esperado: EsperadoDesglose;
  expectedCash: number;
}

// ── La fórmula ──────────────────────────────────────────────────────────

export interface EsperadoPartes {
  opening: MoneyIn;
  cashCharged: MoneyIn;
  cashIn?: MoneyIn;
  cashExpenses?: MoneyIn;
  withdrawals?: MoneyIn;
  cashPayouts?: MoneyIn;
  cashRefunds?: MoneyIn;
}

/**
 * LA fórmula del efectivo esperado (punto único). Todos los sumandos llegan
 * positivos; aquí se decide qué suma y qué resta.
 */
export function esperadoEnEfectivo(p: EsperadoPartes): Prisma.Decimal {
  return D(p.opening)
    .plus(D(p.cashCharged))
    .plus(D(p.cashIn))
    .minus(D(p.cashExpenses))
    .minus(D(p.withdrawals))
    .minus(D(p.cashPayouts))
    .minus(D(p.cashRefunds))
    .toDecimalPlaces(2, ROUND);
}

/**
 * Descuento de un ticket a partir de sus líneas: Σ de las líneas negativas
 * que NO son el anticipo aplicado ni la devolución de un anticipo (ninguno de
 * los dos es descuento). Positivo. Es la regla de getSaleDetail.
 */
export function discountFromItems(items: Array<{ description: string; qty: number; unitPrice: MoneyIn }>): Prisma.Decimal {
  let acc = Z();
  for (const it of items) {
    const unit = D(it.unitPrice);
    if (!unit.isNegative()) continue;
    if (isDepositLine(it.description) || isDepositRefundLine(it.description)) continue;
    acc = acc.plus(unit.times(it.qty));
  }
  return acc.abs().toDecimalPlaces(2, ROUND);
}

function incomeMethodOf(m: BarberPaymentMethod): ResumenIncomeMethod {
  return m === "STRIPE" ? "ONLINE" : m;
}

function isVoided(m: ResumenMovement): boolean {
  return m.voided === true || (m.voidedAt !== undefined && m.voidedAt !== null);
}

// ── El resumen ──────────────────────────────────────────────────────────

export function cajaResumen(input: ResumenInput): CajaResumen {
  const opening = D(input.openingAmount);

  // Tickets
  const byMethod: Record<ResumenIncomeMethod, { count: number; total: Dec }> = {
    CASH: { count: 0, total: Z() },
    CARD: { count: 0, total: Z() },
    SPEI: { count: 0, total: Z() },
    ONLINE: { count: 0, total: Z() },
  };
  const byKind: Record<ResumenTicketKind, { count: number; total: Dec }> = {
    sale: { count: 0, total: Z() },
    membership: { count: 0, total: Z() },
    deposit: { count: 0, total: Z() },
    refund: { count: 0, total: Z() },
  };
  let incomeTotal = Z();
  let salesSubtotal = Z();
  let saleCount = 0;
  let cancelled = 0;
  let tipsTotal = Z();
  let cashTips = Z();
  let cashCharged = Z();
  let cashTickets = 0;
  let cashRefunds = Z();
  let refundsAll = Z();
  let refundCount = 0;
  let discounts = Z();
  const barbers = new Map<string, { name: string; tickets: number; produced: Dec; tips: Dec; paidOut: Dec }>();
  const barberRow = (id: string, name: string | null | undefined) => {
    let b = barbers.get(id);
    if (!b) {
      b = { name: name || "—", tickets: 0, produced: Z(), tips: Z(), paidOut: Z() };
      barbers.set(id, b);
    } else if ((b.name === "—" || !b.name) && name) {
      b.name = name;
    }
    return b;
  };

  for (const t of input.tickets) {
    if (t.cancelled) {
      cancelled += 1;
      continue;
    }
    const total = D(t.total);
    const tip = D(t.tip);
    const sub = D(t.subtotal);
    const method = incomeMethodOf(t.paymentMethod);
    byMethod[method].count += 1;
    byMethod[method].total = byMethod[method].total.plus(total);
    byKind[t.kind].count += 1;
    byKind[t.kind].total = byKind[t.kind].total.plus(total);
    incomeTotal = incomeTotal.plus(total);
    tipsTotal = tipsTotal.plus(tip);

    if (t.kind === "refund") {
      // Ticket negativo: su total ya resta en income; aquí se cuenta aparte.
      refundCount += 1;
      refundsAll = refundsAll.plus(total.abs());
      if (t.paymentMethod === "CASH") cashRefunds = cashRefunds.plus(total.abs());
    } else if (t.paymentMethod === "CASH") {
      cashCharged = cashCharged.plus(total);
      cashTips = cashTips.plus(tip);
      cashTickets += 1;
    }

    if (t.kind === "sale") {
      saleCount += 1;
      salesSubtotal = salesSubtotal.plus(sub);
    }
    discounts = discounts.plus(
      t.discount !== undefined && t.discount !== null ? D(t.discount).abs() : t.items ? discountFromItems(t.items) : Z(),
    );
    if (t.barberId) {
      const b = barberRow(t.barberId, t.barberName);
      if (t.kind === "sale") b.tickets += 1;
      b.produced = b.produced.plus(sub);
      b.tips = b.tips.plus(tip);
    }
  }

  // Movimientos
  const expByCat = new Map<string, { count: number; total: Dec }>();
  const expByMethod = Object.fromEntries(CASH_MOVEMENT_METHODS.map((m) => [m, Z()])) as Record<CashMovementMethod, Dec>;
  let expTotal = Z();
  let expCount = 0;
  let expCash = Z();
  let wdr = Z();
  let wdrCount = 0;
  let dep = Z();
  let depCount = 0;
  let pay = Z();
  let payCount = 0;
  let payCash = Z();
  const payByKind = Object.fromEntries(BARBER_PAYOUT_KINDS.map((k) => [k, Z()])) as Record<BarberPayoutKind, Dec>;
  let voided = 0;

  for (const m of input.movements) {
    if (isVoided(m)) {
      voided += 1;
      continue;
    }
    const amount = D(m.amount).abs();
    const cash = m.method === "CASH";
    switch (m.type) {
      case "EXPENSE": {
        expTotal = expTotal.plus(amount);
        expCount += 1;
        if (cash) expCash = expCash.plus(amount);
        expByMethod[m.method] = (expByMethod[m.method] ?? Z()).plus(amount);
        const cat = m.category || "OTHER";
        const row = expByCat.get(cat) ?? { count: 0, total: Z() };
        row.count += 1;
        row.total = row.total.plus(amount);
        expByCat.set(cat, row);
        break;
      }
      case "WITHDRAWAL":
        wdr = wdr.plus(amount);
        wdrCount += 1;
        break;
      case "DEPOSIT":
        dep = dep.plus(amount);
        depCount += 1;
        break;
      case "BARBER_PAYOUT": {
        pay = pay.plus(amount);
        payCount += 1;
        if (cash) payCash = payCash.plus(amount);
        const kind = m.payoutKind ?? "OTHER";
        payByKind[kind] = (payByKind[kind] ?? Z()).plus(amount);
        if (m.barberId) {
          const b = barberRow(m.barberId, m.barberName);
          b.paidOut = b.paidOut.plus(amount);
        }
        break;
      }
    }
  }

  const expected = esperadoEnEfectivo({
    opening,
    cashCharged,
    cashIn: dep,
    cashExpenses: expCash,
    withdrawals: wdr,
    cashPayouts: payCash,
    cashRefunds,
  });

  const barberList: ResumenBarbero[] = [...barbers.entries()]
    .map(([barberId, b]) => ({
      barberId,
      barberName: b.name,
      tickets: b.tickets,
      produced: out(b.produced),
      tips: out(b.tips),
      paidOut: out(b.paidOut),
    }))
    .sort((a, b) => b.produced - a.produced || a.barberName.localeCompare(b.barberName));

  const ct = (x: { count: number; total: Dec }): CountTotal => ({ count: x.count, total: out(x.total) });

  return {
    opening: out(opening),
    income: {
      total: out(incomeTotal),
      byMethod: { CASH: ct(byMethod.CASH), CARD: ct(byMethod.CARD), SPEI: ct(byMethod.SPEI), ONLINE: ct(byMethod.ONLINE) },
      byKind: { sale: ct(byKind.sale), membership: ct(byKind.membership), deposit: ct(byKind.deposit), refund: ct(byKind.refund) },
      sales: out(salesSubtotal),
    },
    tips: {
      total: out(tipsTotal),
      cash: out(cashTips),
      byBarber: barberList.filter((b) => b.tips !== 0).map((b) => ({ barberId: b.barberId, barberName: b.barberName, total: b.tips })),
    },
    discounts: out(discounts),
    tickets: {
      count: saleCount,
      cancelled,
      average: saleCount === 0 ? 0 : out(salesSubtotal.dividedBy(saleCount)),
    },
    byBarber: barberList,
    expenses: {
      total: out(expTotal),
      count: expCount,
      cash: out(expCash),
      byCategory: [...expByCat.entries()]
        .map(([category, r]) => ({ category, count: r.count, total: out(r.total) }))
        .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category)),
      byMethod: Object.fromEntries(CASH_MOVEMENT_METHODS.map((m) => [m, out(expByMethod[m])])) as Record<CashMovementMethod, number>,
    },
    withdrawals: { count: wdrCount, total: out(wdr) },
    deposits: { count: depCount, total: out(dep) },
    payouts: {
      total: out(pay),
      count: payCount,
      cash: out(payCash),
      byKind: Object.fromEntries(BARBER_PAYOUT_KINDS.map((k) => [k, out(payByKind[k])])) as Record<BarberPayoutKind, number>,
    },
    refunds: { count: refundCount, total: out(refundsAll) },
    voidedMovements: voided,
    esperado: {
      opening: out(opening),
      cashCharged: out(cashCharged),
      cashTickets,
      cashTipsIncluded: out(cashTips),
      cashIn: out(dep),
      cashExpenses: out(expCash),
      withdrawals: out(wdr),
      cashPayouts: out(payCash),
      cashRefunds: out(cashRefunds),
      expected: out(expected),
    },
    expectedCash: out(expected),
  };
}
