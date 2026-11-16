// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — el DINERO COMPLETO fuera de la Caja: Inicio y
// Reportes (ws6-t5, 16-nov-2026).
//
// Las cuentas NO viven aquí: todas salen de cajaResumen (caja-resumen.ts),
// la función única de ws6-t1. Aquí solo se:
//   · CARGA lo que cajaResumen pide, para una o VARIAS sedes (la vista
//     «Toda la cadena»; getCajaResumenPeriodo de cash.ts opera una sola, la
//     de ctx.barbershopId, y trae cada ticket con 5 relaciones = ~8
//     sentencias, demasiado para Inicio). Los tickets van en UNA sentencia
//     con solo las columnas que el resumen usa; los movimientos con
//     loadMovements de ws6-t1. Se manda TODO a una sola llamada de
//     cajaResumen.
//   · calcula lo único que el resumen no trae: la GANANCIA.
//
//   INGRESOS = lo cobrado (income.total) − propinas (tips.total)
//              → es Σ subtotal, la MISMA cifra de «Ingresos» de Inicio y
//                Reportes. La propina es del barbero, no del negocio.
//   GANANCIA = INGRESOS − gastos (todos los medios)
//              − lo DEVENGADO por los barberos en el periodo (sin propinas):
//                  comisión (Σ barber_commission_entries.amount, que nunca
//                  lleva propina) + sueldo del periodo (salaryForRange)
//                  − renta de silla del periodo (prorrateo mensual)
//
// Revisión ws6-t8 (G2): antes restaba los PAGOS a barberos, que llevan la
// propina (totalToPay = comisión + propinas) y dependen de la casilla «Sale de
// la caja» y de cuándo se marcó pagado. Lo devengado no: el mismo mes da la
// misma ganancia, se haya pagado o no. Los pagos se siguen enseñando aparte.
//
// Un gasto con tarjeta o transferencia SÍ resta en la ganancia y NO en el
// efectivo. Los anulados y los tickets cancelados ya los descarta cajaResumen
// (y la comisión de un ticket cancelado se borra con él, cash.ts).
//
// N6 (revisión): getCajaResumenPeriodo (cash.ts, de ws6-t1) es un segundo
// cargador del mismo resumen; hoy solo lo usan sus pruebas. Vive en un
// archivo de t1 y no se toca desde aquí: anotado en el reporte de ws6-t5.
//
// Sin "server-only" (como cash.ts y stats.ts): las pruebas lo importan con tsx.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BarberForbiddenError, hasBarberPermission, type BarberContext } from "@/lib/barber-auth";
import { isSaleCancelled } from "@/lib/barber/commissions";
import { saleKindOf } from "@/lib/barber/memberships-core";
import { cashMovementsReady, loadMovements, type CashMovementRow } from "@/lib/barber/cash-movements";
import {
  cajaResumen,
  type CajaResumen,
  type CountTotal,
  type ResumenIncomeMethod,
  type ResumenTicket,
} from "@/lib/barber/caja-resumen";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { activeSalary, salaryForRange, type BarberSalary } from "@/lib/barber/sueldo-core";
import { loadSalaries, salaryReady } from "@/lib/barber/sueldo";

type Dec = Prisma.Decimal;
const ROUND = Prisma.Decimal.ROUND_HALF_UP;
const D = (n: Prisma.Decimal.Value | null | undefined): Dec => new Prisma.Decimal(n ?? 0);
const out = (d: Dec): number => d.toDecimalPlaces(2, ROUND).toNumber();

/**
 * ¿La ganancia descuenta las propinas? (DECISIÓN PARA RAFAEL, ver el reporte
 * de ws6-t5). true = la propina es del barbero y no cuenta como ingreso del
 * negocio; así «Ingresos» cuadra con la cifra de Inicio y de Reportes.
 */
export const GANANCIA_SIN_PROPINAS = true;

// ── DTO (números listos para JSON) ──────────────────────────────────────

/** Lo que les toca a los barberos por el periodo, SIN propinas (pagado o no). */
export interface CostoBarberos {
  /** Σ comisión devengada (renta de silla: su producción íntegra). */
  commission: number;
  /** Sueldo del periodo de quien cobra por Sueldo. */
  salary: number;
  /** Renta de silla del periodo (la paga el barbero: resta del costo). */
  chairRent: number;
  /** commission + salary − chairRent. */
  total: number;
  /** El sueldo o la renta se prorratearon por días (el periodo no es de meses/semanas completas). */
  approx: boolean;
}

export interface DineroBarbero {
  barberId: string;
  barberName: string;
  tips: number;
  /** Todo lo que se le pagó en el periodo (adelantos, comisión, sueldo, otro). */
  paidOut: number;
  /** De eso, adelantos/vales (ADVANCE). */
  advances: number;
}

export interface DineroPeriodo {
  /** Lo cobrado (tickets vivos, propinas incluidas, menos devoluciones de anticipo). */
  charged: number;
  /** Por medio de cobro (con propinas, como el resumen de Caja). Σ = charged. */
  byMethod: Record<ResumenIncomeMethod, CountTotal>;
  tips: number;
  /** Ingresos del negocio = charged − tips (si GANANCIA_SIN_PROPINAS). */
  income: number;
  expenses: CajaResumen["expenses"];
  /** Lo ENTREGADO a los barberos (con propinas, adelantos…): informativo, no resta en la ganancia. */
  payouts: CajaResumen["payouts"];
  /** Lo devengado por los barberos en el periodo, sin propinas: esto sí resta. */
  barberCost: CostoBarberos;
  /** INGRESOS − gastos − barberCost.total. */
  profit: number;
  /** Flujo neto de efectivo del periodo (sin fondo): lo que el cajón ganó o perdió. */
  cashNet: number;
  byBarber: DineroBarbero[];
}

// ── Puro ────────────────────────────────────────────────────────────────

/** Adelantos (ADVANCE) vivos por barbero: lo que cajaResumen no separa por persona. */
export function adelantosPorBarbero(
  movements: Array<Pick<CashMovementRow, "type" | "payoutKind" | "barberId" | "amount" | "voidedAt">>,
): Map<string, number> {
  const acc = new Map<string, Dec>();
  for (const m of movements) {
    if (m.voidedAt || m.type !== "BARBER_PAYOUT" || m.payoutKind !== "ADVANCE" || !m.barberId) continue;
    acc.set(m.barberId, D(acc.get(m.barberId)).plus(D(m.amount).abs()));
  }
  return new Map([...acc.entries()].map(([k, v]) => [k, out(v)]));
}

export interface CostoBarberoInput {
  id: string;
  commissionType: string;
  isActive: boolean;
  chairRent: Prisma.Decimal.Value | null;
  /** Sueldo guardado (sueldo.ts); null = sin sueldo o sin sql/barber_sueldo.sql. */
  salary: BarberSalary | null;
}

/**
 * Lo devengado por los barberos en [fromDay, toDay) (días locales, fin
 * exclusivo), sin propinas. Puro. Las reglas son las de Comisiones:
 *   COMMISSION → Σ de sus entradas (amount = base × %; nunca lleva propina).
 *   CHAIR_RENT → Σ de sus entradas (su producción íntegra) − renta del
 *                periodo (la renta es mensual: se prorratea por días con la
 *                misma regla que el sueldo, salaryForRange).
 *   SALARY     → sueldo del periodo (salaryForRange) si tiene monto.
 * La comisión cuenta para todo barbero con entradas (también uno ya dado de
 * baja); renta y sueldo, solo para los activos.
 */
export function costoBarberos(args: {
  entries: Map<string, Prisma.Decimal.Value>;
  barbers: CostoBarberoInput[];
  fromDay: string;
  toDay: string;
}): CostoBarberos {
  let commission = new Prisma.Decimal(0);
  let salary = new Prisma.Decimal(0);
  let rent = new Prisma.Decimal(0);
  let approx = false;
  for (const v of args.entries.values()) commission = commission.plus(D(v));
  for (const b of args.barbers) {
    if (!b.isActive) continue;
    if (b.commissionType === "CHAIR_RENT" && b.chairRent !== null && D(b.chairRent).gt(0)) {
      const r = salaryForRange({ amount: D(b.chairRent).toNumber(), period: "MONTHLY" }, args.fromDay, args.toDay);
      rent = rent.plus(r.amount);
      approx = approx || r.approx;
    }
    const s = activeSalary(b.commissionType, b.salary);
    if (s) {
      const r = salaryForRange(s, args.fromDay, args.toDay);
      salary = salary.plus(r.amount);
      approx = approx || r.approx;
    }
  }
  return {
    commission: out(commission),
    salary: out(salary),
    chairRent: out(rent),
    total: out(commission.plus(salary).minus(rent)),
    approx,
  };
}

const SIN_COSTO: CostoBarberos = { commission: 0, salary: 0, chairRent: 0, total: 0, approx: false };

/** Del resumen (cajaResumen) al dinero que enseñan Inicio y Reportes. Puro. */
export function dineroDe(
  resumen: CajaResumen,
  advancesByBarber: Map<string, number> = new Map(),
  barberCost: CostoBarberos = SIN_COSTO,
): DineroPeriodo {
  const charged = D(resumen.income.total);
  const tips = D(resumen.tips.total);
  const income = GANANCIA_SIN_PROPINAS ? charged.minus(tips) : charged;
  const profit = income.minus(D(resumen.expenses.total)).minus(D(barberCost.total));
  return {
    charged: out(charged),
    byMethod: resumen.income.byMethod,
    tips: out(tips),
    income: out(income),
    expenses: resumen.expenses,
    payouts: resumen.payouts,
    barberCost,
    profit: out(profit),
    cashNet: out(D(resumen.esperado.expected).minus(D(resumen.esperado.opening))),
    byBarber: resumen.byBarber
      .filter((b) => b.tips !== 0 || b.paidOut !== 0)
      .map((b) => ({
        barberId: b.barberId,
        barberName: b.barberName,
        tips: b.tips,
        paidOut: b.paidOut,
        advances: advancesByBarber.get(b.barberId) ?? 0,
      })),
  };
}

/** Cambio % contra el periodo anterior (la regla de pctChange de stats.ts). null si el anterior es 0. */
export function cambioPct(current: number, previous: number): number | null {
  const prev = D(previous);
  if (prev.isZero()) return null;
  return D(current).minus(prev).div(prev.abs()).times(100).toDecimalPlaces(1).toNumber();
}

// ── Con base ────────────────────────────────────────────────────────────

interface TicketSql {
  paymentMethod: string;
  subtotal: Prisma.Decimal | string | number;
  tip: Prisma.Decimal | string | number;
  total: Prisma.Decimal | string | number;
  notes: string | null;
  barberId: string | null;
  barber_name: string | null;
  barbershopId: string;
  cashSessionId: string | null;
}

/** Fila mínima → ResumenTicket. Cancelado y tipo por los predicados ÚNICOS (isSaleCancelled, saleKindOf). */
function ticketOf(r: TicketSql): ResumenTicket {
  return {
    paymentMethod: r.paymentMethod as BarberPaymentMethod,
    subtotal: D(r.subtotal),
    tip: D(r.tip),
    total: D(r.total),
    cancelled: isSaleCancelled({ notes: r.notes }),
    kind: saleKindOf(r.notes),
    barberId: r.barberId,
    barberName: r.barber_name,
    // Sin `discount` ni `items`: el descuento no se enseña aquí (sale 0).
  };
}

/** Las columnas son timestamp(3) SIN zona guardadas en UTC (ver stats.ts). */
function utcTs(d: Date): Prisma.Sql {
  return Prisma.sql`timezone('UTC', ${d.toISOString()}::timestamptz)`;
}

const SELECT_TICKET = Prisma.sql`
  SELECT s."paymentMethod"::text AS "paymentMethod", s."subtotal", s."tip", s."total", s."notes", s."barberId",
         COALESCE(NULLIF(b."nickname", ''), b."name") AS barber_name, s."barbershopId", s."cashSessionId"
  FROM "barber_sales" s
  LEFT JOIN "barber_barbers" b ON b."id" = s."barberId"
`;

function assertCashView(ctx: BarberContext): void {
  if (!hasBarberPermission({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride }, "cash.view")) {
    throw new BarberForbiddenError("cash.view");
  }
}

/**
 * Movimientos de las sedes, en tandas de ≤ 5 lecturas en paralelo (regla del
 * pooler).
 */
async function movementsOf(branchIds: string[], range: { from: Date; to: Date }): Promise<{ rows: CashMovementRow[] }> {
  const rows: CashMovementRow[] = [];
  for (let i = 0; i < branchIds.length; i += 5) {
    const tanda = await Promise.all(
      branchIds.slice(i, i + 5).map((id) => loadMovements(prisma, { barbershopId: id, from: range.from, to: range.to, limit: 5000 })),
    );
    for (const r of tanda) {
      rows.push(...r);
    }
  }
  return { rows };
}

/** «YYYY-MM-DD» del instante en la zona de la barbería. */
function dayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export interface DineroOpts {
  /** Turno abierto cuyo cajón también se quiere («En caja ahora» de Inicio). */
  openSession?: { id: string; barbershopId: string; openingAmount: Prisma.Decimal.Value; openedAt: Date } | null;
  now?: Date;
}

export interface DineroResultado {
  dinero: DineroPeriodo;
  /** El esperado del turno abierto con todos sus movimientos (la cuenta de la Caja). null = no se pidió. */
  openExpected: number | null;
}

/**
 * El dinero de un periodo [from, to) de las sedes del alcance. `branchIds`
 * TIENE que venir de resolveStatsScope/resolveBranchScope (ya validado contra
 * las sedes de la sesión): aquí no se decide alcance. Pide cash.view.
 * Sin sql/barber_caja_completa.sql devuelve null: Inicio y Reportes se ven
 * como antes.
 *
 * Lecturas: 1 (¿SQL pegado?, en caché) + 1 tickets + 1 por sede de
 * movimientos + 1 comisión devengada + 1 barberos. Con turno abierto: si se
 * abrió dentro del periodo (el caso de Inicio, abierto hoy), sus tickets y
 * movimientos YA vienen en esas lecturas; si es de otro día, + 1 tickets y
 * + 1 movimientos del turno. Todas las de datos en UN Promise.all (≤ 6).
 * Solo si alguien cobra por Sueldo: + 1 (¿SQL de sueldo?, en caché) + 1 sueldos.
 */
export async function getDineroPeriodo(
  ctx: BarberContext,
  branchIds: string[],
  range: { from: Date; to: Date },
  opts: DineroOpts = {},
): Promise<DineroResultado | null> {
  assertCashView(ctx);
  const ids = Array.from(new Set(branchIds.filter(Boolean)));
  if (ids.length === 0) return null;
  if (!(await cashMovementsReady(prisma))) return null;

  const open = opts.openSession ?? null;
  const now = opts.now ?? new Date();
  // ¿Todo el turno cae dentro del periodo? Abierto en él y el periodo llega hasta ahora.
  const openInside =
    open !== null && ids.includes(open.barbershopId) && open.openedAt.getTime() >= range.from.getTime() && range.to.getTime() > now.getTime();
  const apart = open !== null && !openInside;
  const tz = ctx.barbershop?.timezone || "America/Mexico_City";
  const [tickets, mov, apartTickets, apartMovements, entryGroups, barbers] = await Promise.all([
    prisma.$queryRaw<TicketSql[]>`
      ${SELECT_TICKET}
      WHERE s."barbershopId" IN (${Prisma.join(ids)})
        AND s."createdAt" >= ${utcTs(range.from)} AND s."createdAt" < ${utcTs(range.to)}
    `,
    movementsOf(ids, range),
    apart
      ? prisma.$queryRaw<TicketSql[]>`
          ${SELECT_TICKET}
          WHERE s."barbershopId" = ${open.barbershopId} AND s."cashSessionId" = ${open.id}
        `
      : Promise.resolve([] as TicketSql[]),
    apart ? loadMovements(prisma, { barbershopId: open.barbershopId, sessionIds: [open.id] }) : Promise.resolve([] as CashMovementRow[]),
    // Comisión devengada del periodo: la misma suma que la columna «Comisión» de Reportes.
    prisma.barberCommissionEntry.groupBy({
      by: ["barberId"],
      where: { barbershopId: { in: ids }, createdAt: { gte: range.from, lt: range.to } },
      _sum: { amount: true },
    }),
    prisma.barber.findMany({
      where: { barbershopId: { in: ids } },
      select: { id: true, commissionType: true, isActive: true, chairRent: true },
    }),
  ]);
  const movements = mov.rows;

  // Sueldo: solo si alguien cobra por Sueldo y sql/barber_sueldo.sql está pegado.
  const salaried = barbers.filter((b) => b.isActive && b.commissionType === "SALARY").map((b) => b.id);
  const salaries = salaried.length > 0 && (await salaryReady(prisma)) ? await loadSalaries(prisma, salaried) : new Map<string, BarberSalary | null>();
  const barberCost = costoBarberos({
    entries: new Map(entryGroups.map((g) => [g.barberId, g._sum.amount ?? 0])),
    barbers: barbers.map((b) => ({
      id: b.id,
      commissionType: b.commissionType,
      isActive: b.isActive,
      chairRent: b.chairRent,
      salary: salaries.get(b.id) ?? null,
    })),
    fromDay: dayKey(range.from, tz),
    toDay: dayKey(range.to, tz),
  });

  const resumen = cajaResumen({ openingAmount: 0, tickets: tickets.map(ticketOf), movements });
  let openExpected: number | null = null;
  if (open) {
    const sTickets = apart ? apartTickets : tickets.filter((t) => t.barbershopId === open.barbershopId && t.cashSessionId === open.id);
    const sMovements = apart ? apartMovements : movements.filter((m) => m.sessionId === open.id);
    openExpected = cajaResumen({ openingAmount: open.openingAmount, tickets: sTickets.map(ticketOf), movements: sMovements }).expectedCash;
  }
  return { dinero: dineroDe(resumen, adelantosPorBarbero(movements), barberCost), openExpected };
}

/** Para pruebas y para quien necesite la forma de un DineroPeriodo vacío. */
export function dineroVacio(): DineroPeriodo {
  return dineroDe(cajaResumen({ openingAmount: 0, tickets: [], movements: [] }));
}

