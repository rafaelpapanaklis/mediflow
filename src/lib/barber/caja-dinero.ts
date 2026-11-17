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
// NO incluye cobros en línea que no generan ticket (anticipos con Stripe,
// membresías por suscripción, pedidos de la tienda): ver ONLINE_NOT_INCLUDED.
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
import { activeSalary, chairRentForRange, dayKeyOf, rangeSince, salaryForRange, type BarberSalary } from "@/lib/barber/sueldo-core";
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

/**
 * M4 (revisión ws6-t8): los anticipos pagados en línea no crean ticket ni
 * guardan cuándo se pagaron (y uno de mostrador también queda PAID), las
 * membresías por suscripción y la tienda viven en otras tablas. Sumarlos sin
 * contar doble no es limpio hoy: la pantalla lo AVISA en vez de sumarlos.
 */
export const ONLINE_NOT_INCLUDED = true;

/** Tope de movimientos por sede y consulta (el de loadMovements). Si se llega, `truncated`. */
export const MOVEMENTS_LIMIT = 5000;

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
  /** De eso, lo que salió del cajón: efectivo de un turno de caja. */
  paidDrawer: number;
  /** De eso, lo pagado fuera de caja: otro medio, sin turno o marcado sin «sale de la caja». */
  paidOutside: number;
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
  /** payouts.total partido: efectivo del cajón / fuera de caja. drawer + outside = payouts.total. */
  payoutsSplit: { drawer: number; outside: number };
  /**
   * Lo devengado por los barberos en el periodo, sin propinas: esto sí resta.
   * null = no viaja: quien lo pide no tiene «Ver comisiones» (decisión 2 del QA E).
   */
  barberCost: CostoBarberos | null;
  /** INGRESOS − gastos − barberCost.total. null = no viaja (sin «Ver comisiones»). */
  profit: number | null;
  /** Flujo neto de efectivo del periodo (sin fondo): lo que el cajón ganó o perdió. */
  cashNet: number;
  byBarber: DineroBarbero[];
  /** Alguna sede llegó al tope de movimientos: gastos y pagos pueden estar incompletos. */
  truncated: boolean;
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

/** Lo pagado a barberos, partido en «del cajón» y «fuera de caja». */
export interface PagosPartidos {
  drawer: number;
  outside: number;
  byBarber: Map<string, { drawer: number; outside: number }>;
}

/**
 * Parte los pagos a barberos VIVOS (decisión 1 del QA E, 16-nov-2026):
 *   · «en caja»       = efectivo de un turno de caja (lo único que baja el cajón);
 *   · «fuera de caja» = todo lo demás: tarjeta, transferencia u otro medio, un
 *     pago en efectivo sin caja abierta, y lo marcado pagado en Comisiones sin
 *     «sale de la caja» (commissions.ts lo anota sin turno y sin efectivo).
 * drawer + outside = payouts.total de cajaResumen (mismos movimientos).
 */
export function pagosPartidos(
  movements: Array<Pick<CashMovementRow, "type" | "method" | "sessionId" | "barberId" | "amount" | "voidedAt">>,
): PagosPartidos {
  let drawer = new Prisma.Decimal(0);
  let outside = new Prisma.Decimal(0);
  const acc = new Map<string, { drawer: Dec; outside: Dec }>();
  for (const m of movements) {
    if (m.voidedAt || m.type !== "BARBER_PAYOUT") continue;
    const amount = D(m.amount).abs();
    const enCaja = m.method === "CASH" && Boolean(m.sessionId);
    if (enCaja) drawer = drawer.plus(amount);
    else outside = outside.plus(amount);
    if (!m.barberId) continue;
    const b = acc.get(m.barberId) ?? { drawer: new Prisma.Decimal(0), outside: new Prisma.Decimal(0) };
    if (enCaja) b.drawer = b.drawer.plus(amount);
    else b.outside = b.outside.plus(amount);
    acc.set(m.barberId, b);
  }
  return {
    drawer: out(drawer),
    outside: out(outside),
    byBarber: new Map([...acc.entries()].map(([k, v]) => [k, { drawer: out(v.drawer), outside: out(v.outside) }])),
  };
}

export interface CostoBarberoInput {
  id: string;
  commissionType: string;
  isActive: boolean;
  chairRent: Prisma.Decimal.Value | null;
  /** Sueldo guardado (sueldo.ts); null = sin sueldo o sin sql/barber_sueldo.sql. */
  salary: BarberSalary | null;
  /**
   * Día de ALTA del barbero («YYYY-MM-DD» en la zona de la barbería). Renta y
   * sueldo cuentan desde ese día (decisión 3 del QA E). null/ausente = sin dato.
   */
  since?: string | null;
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
 * baja); renta y sueldo, solo para los activos y SOLO DESDE SU ALTA (decisión
 * 3 del QA E): los días del periodo anteriores a `since` no cuentan.
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
      const r = chairRentForRange(b.chairRent, args.fromDay, args.toDay, b.since);
      rent = rent.plus(r.amount);
      approx = approx || r.approx;
    }
    const s = activeSalary(b.commissionType, b.salary);
    if (s) {
      const desde = rangeSince(args.fromDay, args.toDay, b.since);
      const r = salaryForRange(s, desde.from, desde.to);
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
  /** null = sin «Ver comisiones»: ni lo devengado ni la ganancia se calculan. */
  barberCost: CostoBarberos | null = SIN_COSTO,
  truncated = false,
  /** Sin él (llamadores viejos, pruebas): todo lo pagado se toma como «del cajón» salvo lo que no fue efectivo. */
  pagos: PagosPartidos | null = null,
): DineroPeriodo {
  const charged = D(resumen.income.total);
  const tips = D(resumen.tips.total);
  const income = GANANCIA_SIN_PROPINAS ? charged.minus(tips) : charged;
  const profit = barberCost === null ? null : income.minus(D(resumen.expenses.total)).minus(D(barberCost.total));
  return {
    charged: out(charged),
    byMethod: resumen.income.byMethod,
    tips: out(tips),
    income: out(income),
    expenses: resumen.expenses,
    payouts: resumen.payouts,
    payoutsSplit: pagos
      ? { drawer: pagos.drawer, outside: pagos.outside }
      : { drawer: resumen.payouts.cash, outside: out(D(resumen.payouts.total).minus(D(resumen.payouts.cash))) },
    barberCost,
    profit: profit === null ? null : out(profit),
    cashNet: out(D(resumen.esperado.expected).minus(D(resumen.esperado.opening))),
    byBarber: resumen.byBarber
      .filter((b) => b.tips !== 0 || b.paidOut !== 0)
      .map((b) => ({
        barberId: b.barberId,
        barberName: b.barberName,
        tips: b.tips,
        paidOut: b.paidOut,
        paidDrawer: pagos ? pagos.byBarber.get(b.barberId)?.drawer ?? 0 : b.paidOut,
        paidOutside: pagos ? pagos.byBarber.get(b.barberId)?.outside ?? 0 : 0,
        advances: advancesByBarber.get(b.barberId) ?? 0,
      })),
    truncated,
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
 * pooler). `truncated` = alguna sede llegó al tope de loadMovements (N5).
 */
async function movementsOf(branchIds: string[], range: { from: Date; to: Date }): Promise<{ rows: CashMovementRow[]; truncated: boolean }> {
  const rows: CashMovementRow[] = [];
  let truncated = false;
  for (let i = 0; i < branchIds.length; i += 5) {
    const tanda = await Promise.all(
      branchIds.slice(i, i + 5).map((id) => loadMovements(prisma, { barbershopId: id, from: range.from, to: range.to, limit: MOVEMENTS_LIMIT })),
    );
    for (const r of tanda) {
      if (r.length >= MOVEMENTS_LIMIT) truncated = true;
      rows.push(...r);
    }
  }
  return { rows, truncated };
}

/** «YYYY-MM-DD» del instante en la zona de la barbería. */
function dayKey(d: Date, tz: string): string {
  return dayKeyOf(d, tz);
}

export interface DineroOpts {
  /** Turno abierto cuyo cajón también se quiere («En caja ahora» de Inicio). */
  openSession?: { id: string; barbershopId: string; openingAmount: Prisma.Decimal.Value; openedAt: Date } | null;
  now?: Date;
  /**
   * false = quien lo pide NO tiene «Ver comisiones» (decisión 2 del QA E,
   * 16-nov-2026): no se lee ni se devuelve lo que ganan los barberos —la
   * Ganancia, lo devengado, lo pagado por barbero y por tipo (ahí va «Sueldos»)—.
   * Lo demás (ingresos, gastos, total entregado, cajón) es de «Ver caja» y viaja.
   */
  withProfit?: boolean;
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
  const withProfit = opts.withProfit !== false;
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
    // Sin «Ver comisiones» ni se lee.
    withProfit
      ? prisma.barberCommissionEntry.groupBy({
          by: ["barberId"],
          where: { barbershopId: { in: ids }, createdAt: { gte: range.from, lt: range.to } },
          _sum: { amount: true },
        })
      : Promise.resolve([] as Array<{ barberId: string; _sum: { amount: Prisma.Decimal | null } }>),
    withProfit
      ? prisma.barber.findMany({
          where: { barbershopId: { in: ids } },
          select: { id: true, commissionType: true, isActive: true, chairRent: true, createdAt: true },
        })
      : Promise.resolve([] as Array<{ id: string; commissionType: string; isActive: boolean; chairRent: Prisma.Decimal | null; createdAt: Date }>),
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
      since: dayKeyOf(b.createdAt, tz),
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
  const pagos = pagosPartidos(movements);
  if (!withProfit) {
    // Sin «Ver comisiones»: el total entregado y su reparto caja/fuera sí (es
    // dinero que salió); por barbero y por tipo, no.
    const d = dineroDe(resumen, new Map(), null, mov.truncated, pagos);
    const sinTipos = Object.fromEntries(Object.keys(d.payouts.byKind).map((k) => [k, 0])) as CajaResumen["payouts"]["byKind"];
    return { dinero: { ...d, byBarber: [], payouts: { ...d.payouts, byKind: sinTipos } }, openExpected };
  }
  return { dinero: dineroDe(resumen, adelantosPorBarbero(movements), barberCost, mov.truncated, pagos), openExpected };
}

/** Para pruebas y para quien necesite la forma de un DineroPeriodo vacío. */
export function dineroVacio(): DineroPeriodo {
  return dineroDe(cajaResumen({ openingAmount: 0, tickets: [], movements: [] }));
}

