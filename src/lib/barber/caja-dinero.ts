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
//   GANANCIA = INGRESOS − gastos (todos los medios) − pagos a barberos
//
// Un gasto con tarjeta o transferencia SÍ resta en la ganancia y NO en el
// efectivo. Los anulados y los tickets cancelados ya los descarta cajaResumen.
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
  payouts: CajaResumen["payouts"];
  /** INGRESOS − gastos − pagos a barberos. */
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

/** Del resumen (cajaResumen) al dinero que enseñan Inicio y Reportes. Puro. */
export function dineroDe(resumen: CajaResumen, advancesByBarber: Map<string, number> = new Map()): DineroPeriodo {
  const charged = D(resumen.income.total);
  const tips = D(resumen.tips.total);
  const income = GANANCIA_SIN_PROPINAS ? charged.minus(tips) : charged;
  const profit = income.minus(D(resumen.expenses.total)).minus(D(resumen.payouts.total));
  return {
    charged: out(charged),
    byMethod: resumen.income.byMethod,
    tips: out(tips),
    income: out(income),
    expenses: resumen.expenses,
    payouts: resumen.payouts,
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

/** Sedes en tandas de ≤ 6 lecturas en paralelo (regla del pooler). */
async function movementsOf(branchIds: string[], range: { from: Date; to: Date }): Promise<CashMovementRow[]> {
  const all: CashMovementRow[] = [];
  for (let i = 0; i < branchIds.length; i += 5) {
    const tanda = await Promise.all(
      branchIds.slice(i, i + 5).map((id) => loadMovements(prisma, { barbershopId: id, from: range.from, to: range.to, limit: 5000 })),
    );
    for (const rows of tanda) all.push(...rows);
  }
  return all;
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
 * movimientos. Con turno abierto: si se abrió dentro del periodo (el caso de
 * Inicio, abierto hoy), sus tickets y movimientos YA vienen en esas
 * lecturas; si es de otro día, + 1 tickets y + 1 movimientos del turno.
 * Todas las de datos en UN Promise.all (≤ 6).
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
  const [tickets, movements, apartTickets, apartMovements] = await Promise.all([
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
  ]);

  const resumen = cajaResumen({ openingAmount: 0, tickets: tickets.map(ticketOf), movements });
  let openExpected: number | null = null;
  if (open) {
    const sTickets = apart ? apartTickets : tickets.filter((t) => t.barbershopId === open.barbershopId && t.cashSessionId === open.id);
    const sMovements = apart ? apartMovements : movements.filter((m) => m.sessionId === open.id);
    openExpected = cajaResumen({ openingAmount: open.openingAmount, tickets: sTickets.map(ticketOf), movements: sMovements }).expectedCash;
  }
  return { dinero: dineroDe(resumen, adelantosPorBarbero(movements)), openExpected };
}

/** Para pruebas y para quien necesite la forma de un DineroPeriodo vacío. */
export function dineroVacio(): DineroPeriodo {
  return dineroDe(cajaResumen({ openingAmount: 0, tickets: [], movements: [] }));
}

