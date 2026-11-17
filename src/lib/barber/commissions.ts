// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — comisiones y nómina por barbero.
//
// Este módulo es la BASE del dinero del vertical: además del motor de
// comisiones aloja los helpers compartidos por caja (cash.ts) e inventario
// (inventory.ts) — Decimal, errores tipados, periodos por zona horaria y la
// convención de ticket cancelado. Viven aquí para que el grafo de imports sea
// un DAG (commissions ← inventory ← cash) y ningún archivo importe a cash.ts.
//
// REGLAS DE DINERO (del contrato de la ola):
//  · Todo se calcula en Prisma.Decimal; nunca en float. El redondeo es
//    explícito y ocurre UNA vez, al final, con money().
//  · La comisión se calcula sobre el SUBTOTAL del ticket SIN propina. La
//    propina es del barbero íntegra (BarberSale.tip) y jamás entra a la base.
//  · Excepción (decisión de Rafael, 14-nov-2026): un corte cubierto por
//    membresía o gratis por lealtad se cobra en $0, pero SÍ comisiona sobre
//    el precio normal del servicio (cash.ts guarda ese precio solo para la
//    base). El ingreso de la barbería no cambia: el ticket sigue en $0.
//  · Base configurable por barbería (CommissionPolicy): "SERVICES" = solo
//    servicios (+ descuentos del ticket); "SERVICES_AND_PRODUCTS" = también el
//    retail. Ver getCommissionPolicy: hoy la política persiste en código
//    (DEFAULT_COMMISSION_POLICY) porque el schema no tiene columna para ella;
//    el punto de lectura es ÚNICO para que al agregar la columna cambie solo
//    esa función.
//  · Los tres esquemas reales del mercado (Barber.commissionType):
//      COMMISSION  → amount = base × pct / 100 (pct por barbero).
//      CHAIR_RENT  → amount = base (el barbero se queda todo); la renta de
//                    silla se resta UNA vez por periodo en payoutFor().
//      SALARY      → amount = 0 (sueldo fijo fuera de esta vista); solo cobra
//                    aquí sus propinas.
//    Se genera UNA entrada por venta con barbero, congelada al cobrar
//    (cambiar el esquema del barbero no reescribe el pasado).
//  · periodKey = "YYYY-MM" en la zona horaria de la barbería.
//  · «A pagar» es SOLO LO PENDIENTE (decisión de Rafael, 14-nov-2026): la
//    comisión sin pagar + las propinas de los tickets aún no pagados − la
//    renta de silla si todavía no se descontó. Lo ya pagado se muestra
//    aparte. La cifra sale de UNA función (ledgerRowFor) que usan la tabla,
//    el diálogo de pagar, el recibo y el propio pago: no pueden diferir.
//    No hay columnas nuevas: una propina está pagada cuando lo está la
//    entrada de comisión de su ticket (cada ticket con barbero tiene una), y
//    la renta está descontada cuando el periodo ya tiene algún pago.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertBarberPermission, type BarberContext } from "@/lib/barber-auth";
import { BarberForbiddenError, canMarkCommissionsPaid } from "@/lib/barber/permissions";
import type {
  BarberCommissionEntryDTO,
  BarberCommissionType,
  BarberPaymentMethod,
} from "@/lib/barber/types";
// Núcleo puro (sin prisma): no rompe el DAG commissions ← inventory ← cash.
import { isDepositLine, isMembershipLine } from "@/lib/barber/memberships-core";
import { isLoyaltyFreeLine } from "@/lib/barber/loyalty-core";
// Sueldo opcional del barbero (ws6-t6): núcleo puro + SQL crudo que degrada.
import {
  activeSalary,
  chairRentForRange,
  dayKeyOf,
  hiredInside,
  periodKeyDays,
  salaryForPeriodKey,
  type BarberSalary,
  type BarberSalaryPeriod,
} from "@/lib/barber/sueldo-core";
import { insertSalaryPayment, loadSalaries, loadSalaryPaid, salaryReady } from "@/lib/barber/sueldo";
import { cashMovementsReady, insertMovement, loadAdvances, lockOpenSessionShared, retryIfCajaSqlGone, settleAdvances, unsettleAdvances, type AdvanceRow } from "@/lib/barber/cash-movements";
import { isCashMovementMethod, type CashMovementMethod } from "@/lib/barber/caja-movimientos-core";
import { randomUUID } from "node:crypto";

// ── Dinero ──────────────────────────────────────────────────────────────

export type Money = Prisma.Decimal;

const ROUND = Prisma.Decimal.ROUND_HALF_UP;

/** Decimal a partir de lo que sea (null/undefined → 0). NO redondea. */
export function D(v: Prisma.Decimal | number | string | null | undefined): Money {
  if (v === null || v === undefined || v === "") return new Prisma.Decimal(0);
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/** Redondeo ÚNICO a centavos (half-up). Se aplica al final de cada cálculo. */
export function money(v: Prisma.Decimal | number | string | null | undefined): Money {
  return D(v).toDecimalPlaces(2, ROUND);
}

/** Decimal → number con 2 decimales (para DTOs JSON). */
export function toNum(v: Prisma.Decimal | number | string | null | undefined): number {
  return money(v).toNumber();
}

export const ZERO: Money = new Prisma.Decimal(0);

export function sumMoney(values: Array<Prisma.Decimal | number | string | null | undefined>): Money {
  return values.reduce<Money>((acc, v) => acc.plus(D(v)), ZERO);
}

/**
 * Valida un monto que llega del cliente (JSON): número finito, dentro de
 * [min, max] y con máximo 2 decimales — así el redondeo sigue ocurriendo una
 * sola vez (al final) y no "al leer el input". Lanza BarberCajaError 400.
 */
export function parseMoneyInput(
  raw: unknown,
  opts: { field: string; min?: Money | number; max?: Money | number; required?: boolean },
): Money {
  const { field, min = 0, max = 9_999_999.99, required = false } = opts;
  if (raw === undefined || raw === null || raw === "") {
    if (required) throw new BarberCajaError(400, "INVALID_AMOUNT", `${field}: monto requerido`);
    return ZERO;
  }
  let dec: Money;
  try {
    if (typeof raw === "number") {
      if (!Number.isFinite(raw)) throw new Error("nan");
      dec = new Prisma.Decimal(raw);
    } else if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
      dec = new Prisma.Decimal(raw.trim());
    } else {
      throw new Error("format");
    }
  } catch {
    throw new BarberCajaError(400, "INVALID_AMOUNT", `${field}: monto inválido`);
  }
  if (dec.decimalPlaces() > 2) {
    throw new BarberCajaError(400, "INVALID_AMOUNT", `${field}: máximo 2 decimales`);
  }
  if (dec.lt(D(min))) {
    throw new BarberCajaError(400, "INVALID_AMOUNT", `${field}: no puede ser menor a ${D(min).toFixed(2)}`);
  }
  if (dec.gt(D(max))) {
    throw new BarberCajaError(400, "INVALID_AMOUNT", `${field}: excede el máximo permitido`);
  }
  return dec;
}

/** Entero ≥ 1 (cantidades). Lanza 400. */
export function parseQty(raw: unknown, field = "qty"): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    throw new BarberCajaError(400, "INVALID_QTY", `${field}: cantidad inválida`);
  }
  return n;
}

// ── Errores ─────────────────────────────────────────────────────────────

/**
 * Error tipado del dinero barber. Las APIs lo mapean a `status` con `code`
 * legible por la UI (OUT_OF_STOCK, NO_OPEN_SESSION, SESSION_CLOSED…).
 */
export class BarberCajaError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BarberCajaError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ── Ticket cancelado (convención) ───────────────────────────────────────
//
// BarberSale NO tiene status/cancelledAt (Ola 0). La cancelación es un
// SOFT-CANCEL con dos efectos, ambos en la misma transacción (cash.ts):
//   1. subtotal, tip y total quedan en 0 y las líneas se borran → CUALQUIER
//      agregado (producción, propinas, esperado de caja) excluye el ticket
//      por construcción, aunque quien consulte olvide filtrar. Es la lección
//      del dental con las facturas canceladas.
//   2. notes empieza con CANCELLED_MARK + quién/cuándo/motivo + el resumen
//      del ticket original (auditoría humana).
// isSaleCancelled() es el ÚNICO predicado; no se parsea notes en otro lado.
// Recomendación para Schema-C: columnas cancelledAt / cancelledByUserId /
// cancelReason y este predicado pasa a mirarlas.

export const CANCELLED_MARK = "[CANCELADA]";

export function isSaleCancelled(sale: { notes: string | null }): boolean {
  return typeof sale.notes === "string" && sale.notes.startsWith(CANCELLED_MARK);
}

// ── Periodos por zona horaria ───────────────────────────────────────────

export const DEFAULT_BARBER_TZ = "America/Mexico_City";

interface ZonedParts {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  min: number;
  s: number;
}

function formatterFor(tz: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return formatterFor(DEFAULT_BARBER_TZ);
  }
}

/** Componentes de `date` vistos desde la zona `tz`. */
export function zonedParts(date: Date, tz: string): ZonedParts {
  const map: Record<string, string> = {};
  for (const p of formatterFor(tz || DEFAULT_BARBER_TZ).formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    h: Number(map.hour) % 24,
    min: Number(map.minute),
    s: Number(map.second),
  };
}

function tzOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - date.getTime();
}

/** Instante UTC de las 00:00 del día (y, m, d) en la zona `tz`. */
export function zonedMidnightUtc(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - offset);
}

/** Inicio del día natural de `date` en la zona (instante UTC). */
export function startOfDayInTz(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return zonedMidnightUtc(p.y, p.m, p.d, tz);
}

/** "YYYY-MM" del instante `date` visto desde la zona de la barbería. */
export function periodKeyFor(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}`;
}

export function currentPeriodKey(tz: string, now: Date = new Date()): string {
  return periodKeyFor(now, tz);
}

export function isValidPeriodKey(key: unknown): key is string {
  return typeof key === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
}

/** Rango [start, end) en UTC del mes `periodKey` en la zona `tz`. */
export function periodRange(periodKey: string, tz: string): { start: Date; end: Date } {
  if (!isValidPeriodKey(periodKey)) {
    throw new BarberCajaError(400, "INVALID_PERIOD", "Periodo inválido (usa YYYY-MM)");
  }
  const [ys, ms] = periodKey.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const start = zonedMidnightUtc(y, m, 1, tz);
  const end = m === 12 ? zonedMidnightUtc(y + 1, 1, 1, tz) : zonedMidnightUtc(y, m + 1, 1, tz);
  return { start, end };
}

/** Periodo anterior / siguiente ("2026-01" → "2025-12"). */
export function shiftPeriodKey(periodKey: string, delta: number): string {
  const [ys, ms] = periodKey.split("-");
  const idx = Number(ys) * 12 + (Number(ms) - 1) + delta;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

// ── Política de comisión (configurable por barbería) ────────────────────

export type CommissionBase = "SERVICES" | "SERVICES_AND_PRODUCTS";

export interface CommissionPolicy {
  /** Qué líneas del ticket forman la base. La propina NUNCA. */
  base: CommissionBase;
}

export const COMMISSION_BASE_LABELS: Record<CommissionBase, string> = {
  SERVICES: "Solo servicios",
  SERVICES_AND_PRODUCTS: "Servicios y productos",
};

export const DEFAULT_COMMISSION_POLICY: CommissionPolicy = { base: "SERVICES" };

/**
 * Política vigente de la barbería. PUNTO ÚNICO de lectura.
 *
 * Hoy devuelve DEFAULT_COMMISSION_POLICY para todas: el schema (Ola 0 +
 * complemento B) no tiene columna donde persistirla y esta ola no puede
 * tocar el schema. Cuando exista (propuesta: Barbershop.commissionBase
 * "SERVICES" | "SERVICES_AND_PRODUCTS", default "SERVICES"), esta función
 * la lee y NADA más cambia: cash.ts ya la pide al cobrar y la UI la
 * muestra. El parámetro se conserva para que la firma no cambie.
 */
export async function getCommissionPolicy(_barbershopId: string): Promise<CommissionPolicy> {
  return DEFAULT_COMMISSION_POLICY;
}

// ── Motor (puro) ────────────────────────────────────────────────────────

export type CommissionLineKind = "service" | "product" | "adjustment";

/** Línea del ticket vista por el motor. adjustment = descuento del ticket
 *  (unitPrice negativo) o cualquier línea libre sin servicio ni producto. */
export interface CommissionLine {
  kind: CommissionLineKind;
  qty: number;
  unitPrice: Prisma.Decimal | number | string;
}

export function lineTotal(line: { qty: number; unitPrice: Prisma.Decimal | number | string }): Money {
  return D(line.unitPrice).times(line.qty);
}

/**
 * Base de comisión de un ticket según la política. Suma servicios y
 * descuentos siempre; productos solo con SERVICES_AND_PRODUCTS. La propina
 * no es una línea, así que jamás puede colarse. Nunca negativa.
 */
export function commissionBaseFor(lines: CommissionLine[], policy: CommissionPolicy): Money {
  let base = ZERO;
  for (const line of lines) {
    if (line.kind === "product" && policy.base !== "SERVICES_AND_PRODUCTS") continue;
    base = base.plus(lineTotal(line));
  }
  return base.isNegative() ? ZERO : base;
}

export interface CommissionBarberShape {
  commissionType: BarberCommissionType;
  commissionPct: Prisma.Decimal | number | string | null;
  chairRent: Prisma.Decimal | number | string | null;
}

export interface CommissionResult {
  base: Money;
  /** null para CHAIR_RENT y SALARY (no aplica un porcentaje). */
  pct: Money | null;
  amount: Money;
}

/**
 * Comisión devengada POR UNA VENTA bajo el esquema del barbero.
 *   COMMISSION → base × pct / 100.
 *   CHAIR_RENT → base íntegra (la renta se descuenta por periodo).
 *   SALARY     → 0.
 * base ya viene sin propina (commissionBaseFor). Redondeo único al final.
 */
export function computeCommission(barber: CommissionBarberShape, base: Money): CommissionResult {
  const cleanBase = money(base.isNegative() ? ZERO : base);
  switch (barber.commissionType) {
    case "COMMISSION": {
      const pct = money(barber.commissionPct ?? 0);
      const amount = money(cleanBase.times(pct).div(100));
      return { base: cleanBase, pct, amount };
    }
    case "CHAIR_RENT":
      return { base: cleanBase, pct: null, amount: cleanBase };
    case "SALARY":
    default:
      return { base: cleanBase, pct: null, amount: ZERO };
  }
}

/**
 * Total a pagar al barbero en el periodo (lo que la caja le debe).
 *   COMMISSION → Σ comisión + propinas.
 *   CHAIR_RENT → Σ producción (amount) − renta de silla + propinas. Puede ser
 *                negativo: el barbero le debe la diferencia a la barbería.
 *   SALARY     → propinas (el sueldo se paga por nómina, fuera de aquí).
 */
export function payoutFor(
  type: BarberCommissionType,
  parts: { commissionTotal: Money; tips: Money; chairRent: Money | null; salary?: Money | null },
): Money {
  switch (type) {
    case "COMMISSION":
      return money(parts.commissionTotal.plus(parts.tips));
    case "CHAIR_RENT":
      return money(parts.commissionTotal.minus(parts.chairRent ?? ZERO).plus(parts.tips));
    case "SALARY":
    default:
      // Con sueldo capturado (ws6-t6), el sueldo del periodo se suma a sus propinas.
      return money(parts.tips.plus(parts.salary ?? ZERO));
  }
}

export interface PayoutSplit {
  /** Lo que falta por pagarle (puede ser negativo en renta de silla). */
  toPay: Money;
  /** Lo que ya se le pagó en el periodo. */
  paid: Money;
  /** ¿La renta de silla del periodo ya se descontó en un pago anterior? */
  rentDiscounted: boolean;
  /** Renta que TODAVÍA se va a descontar de «a pagar» (null si no renta silla). */
  rentPending: Money | null;
}

/**
 * Parte lo del periodo en «a pagar» y «ya pagado».
 *   COMMISSION → a pagar = comisión pendiente + propinas pendientes.
 *   CHAIR_RENT → igual, menos la renta SI aún no se descontó. La renta se
 *                descuenta UNA vez: en el primer pago del periodo. A partir
 *                de ahí cuenta dentro de «ya pagado» y no vuelve a restar.
 *   SALARY     → solo propinas (el sueldo va por nómina).
 * Invariante: toPay + paid === payoutFor(total del periodo). Nada se pierde
 * ni se cuenta dos veces al pasar de un lado al otro.
 */
export function splitPayout(
  type: BarberCommissionType,
  parts: {
    commissionPending: Money;
    commissionPaid: Money;
    tipsPending: Money;
    tipsPaid: Money;
    chairRent: Money | null;
    /** Ya hubo al menos un pago en el periodo. */
    anyPaid: boolean;
    /** Sueldo del periodo (solo SALARY con monto capturado); null = sin sueldo. */
    salary?: Money | null;
    /** Sueldo YA pagado en el periodo (congelado al pagar); null = aún no. */
    salaryPaid?: Money | null;
  },
): PayoutSplit {
  switch (type) {
    case "COMMISSION":
      return {
        toPay: money(parts.commissionPending.plus(parts.tipsPending)),
        paid: money(parts.commissionPaid.plus(parts.tipsPaid)),
        rentDiscounted: false,
        rentPending: null,
      };
    case "CHAIR_RENT": {
      const rent = money(parts.chairRent ?? ZERO);
      const rentDiscounted = parts.anyPaid;
      return {
        toPay: money(parts.commissionPending.plus(parts.tipsPending).minus(rentDiscounted ? ZERO : rent)),
        paid: rentDiscounted ? money(parts.commissionPaid.plus(parts.tipsPaid).minus(rent)) : ZERO,
        rentDiscounted,
        rentPending: rentDiscounted ? ZERO : rent,
      };
    }
    case "SALARY":
    default: {
      // El sueldo se paga UNA vez por periodo: mientras no haya renglón en
      // barber_salary_payments va en «a pagar»; después, lo pagado (congelado).
      const salaryPaid = parts.salaryPaid ?? null;
      const salaryDue = salaryPaid === null ? money(parts.salary ?? ZERO) : ZERO;
      return {
        toPay: money(parts.tipsPending.plus(salaryDue)),
        paid: money(parts.tipsPaid.plus(salaryPaid ?? ZERO)),
        rentDiscounted: false,
        rentPending: null,
      };
    }
  }
}

// ── Lectura / pago (DB) ─────────────────────────────────────────────────

export type CommissionPaidStatus = "EMPTY" | "PENDING" | "PARTIAL" | "PAID";

export interface CommissionSummaryRow {
  barberId: string;
  barberName: string;
  nickname: string | null;
  isActive: boolean;
  commissionType: BarberCommissionType;
  commissionPct: number | null;
  /**
   * Renta de silla DEL PERIODO (null si no renta silla). Cuenta desde el alta
   * del barbero (decisión 3 del QA E): el mes de su alta sale proporcional y
   * los meses anteriores, en $0.
   */
  chairRent: number | null;
  /** La renta mensual de su ficha, tal cual (null si no renta silla). */
  chairRentMonthly?: number | null;
  /** La renta del periodo salió proporcional (el alta cae dentro del mes). */
  chairRentApprox?: boolean;
  /**
   * Día de alta («YYYY-MM-DD») si cae DENTRO de este periodo: renta y sueldo
   * salen proporcionales desde ese día. null = alta anterior (mes completo) o
   * posterior (todavía no estaba).
   */
  hiredInPeriod?: string | null;
  ticketCount: number;
  servicesTotal: number;
  productsTotal: number;
  adjustmentsTotal: number;
  /** Σ subtotal de sus tickets (sin propina). */
  produced: number;
  tips: number;
  /** Σ base de sus entradas (lo que de verdad comisionó según la política). */
  commissionBase: number;
  commissionTotal: number;
  commissionPaid: number;
  commissionPending: number;
  /** Propinas de tickets cuya entrada ya está pagada. */
  tipsPaid: number;
  /** Propinas de tickets aún no pagados. */
  tipsPending: number;
  /** ¿La renta de silla del periodo ya se descontó en un pago anterior? */
  chairRentDiscounted: boolean;
  /** Renta que todavía se descuenta de «a pagar» (null si no renta silla). */
  chairRentPending: number | null;
  /** Sueldo capturado en la ficha (aunque hoy no cobre por Sueldo); null = sin sueldo. */
  salaryAmount: number | null;
  salaryPeriod: BarberSalaryPeriod | null;
  /** «Sueldo del periodo»: solo si cobra por Sueldo y tiene monto; null = no aplica. */
  salaryPeriodTotal: number | null;
  /** El periodo no cuadra con semanas/quincenas completas: prorrateo por días («aprox.»). */
  salaryApprox: boolean;
  /** Sueldo del periodo que todavía va en «a pagar» (0 si ya se pagó; null si no aplica). */
  salaryPending: number | null;
  /** Sueldo ya pagado en el periodo (monto congelado al pagar); null = aún no. */
  salaryPaid: number | null;
  /**
   * A PAGAR = solo lo pendiente: comisión sin pagar + propinas de tickets
   * sin pagar − renta aún no descontada. Es la cifra de la tabla, del
   * diálogo de pagar y del recibo.
   */
  totalToPay: number;
  /** YA PAGADO en el periodo (comisión + propinas pagadas − renta descontada). */
  paidTotal: number;
  /** totalToPay + paidTotal: todo lo que le toca por el periodo. */
  periodTotal: number;
  paidStatus: CommissionPaidStatus;
  lastPaidAt: string | null;
  entryCount: number;
  /**
   * Adelantos/vales del periodo dados desde Caja y AÚN NO descontados (caja
   * completa, ws6-t1). Ya están restados de totalToPay y sumados a paidTotal:
   * el siguiente pago los descuenta solo. Sin el SQL, 0.
   */
  advances?: number;
  /** Adelantos del periodo que ya se descontaron en un pago anterior. */
  advancesSettled?: number;
  /** «A pagar» ANTES de restar los adelantos (comisión + propinas [+ sueldo] − renta). */
  grossToPay?: number;
}

export interface CommissionSummary {
  periodKey: string;
  timezone: string;
  policy: CommissionPolicy;
  /** true si el usuario solo puede ver lo suyo (rol BARBER). */
  selfOnly: boolean;
  rows: CommissionSummaryRow[];
  totals: {
    produced: number;
    tips: number;
    commissionTotal: number;
    commissionPending: number;
    /** Σ «a pagar» (pendiente). */
    totalToPay: number;
    /** Σ «ya pagado». */
    paidTotal: number;
  };
}

/**
 * Alcance por rol: OWNER/MANAGER/RECEPTION (con commissions.view) ven todos
 * los barberos de la barbería; un usuario con rol BARBER ve SOLO su fila
 * Barber (ctx.barber) — si no tiene fila ligada, no ve nada. Si además pide
 * un barberId ajeno explícito → 403. Este recorte es del SERVIDOR: la UI
 * solo pinta lo que llega.
 */
export function resolveCommissionScope(
  ctx: Pick<BarberContext, "role" | "barber">,
  requestedBarberId?: string | null,
): { selfOnly: boolean; barberIds: string[] | null } {
  if (ctx.role === "BARBER") {
    const own = ctx.barber?.id ?? null;
    if (requestedBarberId && requestedBarberId !== own) {
      throw new BarberCajaError(403, "FORBIDDEN_SCOPE", "Solo puedes ver tus propias comisiones");
    }
    return { selfOnly: true, barberIds: own ? [own] : [] };
  }
  return { selfOnly: false, barberIds: requestedBarberId ? [requestedBarberId] : null };
}

/**
 * Estado del periodo para un barbero.
 *   EMPTY   → sin tickets.
 *   PENDING → hay algo por pagar y todavía no se le ha pagado nada.
 *   PARTIAL → ya hubo un pago y volvió a juntarse algo por pagar.
 *   PAID    → nada pendiente (o solo entradas de $0 sin propina: sueldo fijo).
 */
function paidStatusOf(a: {
  entryCount: number;
  pendingCount: number;
  paidCount: number;
  pendingAmount: Money;
  /** Sueldo del periodo: null = no aplica; pending = aún no pagado. */
  salary?: { pending: boolean } | null;
}): CommissionPaidStatus {
  // Sueldo (ws6-t6): sin tickets también hay algo que pagar.
  if (a.salary) {
    if (a.salary.pending) return a.paidCount > 0 ? "PARTIAL" : "PENDING";
    if (a.pendingCount === 0 || a.pendingAmount.isZero()) return "PAID";
    return "PARTIAL";
  }
  if (a.entryCount === 0) return "EMPTY";
  if (a.pendingCount === 0 || a.pendingAmount.isZero()) return "PAID";
  return a.paidCount > 0 ? "PARTIAL" : "PENDING";
}

// ── Libro del periodo: UNA sola cuenta para tabla, diálogo, recibo y pago ──

type Db = Pick<Prisma.TransactionClient, "barber" | "barberSale" | "barberCommissionEntry" | "$queryRaw" | "$executeRaw">;

/** Sueldo de cada barbero para el libro del periodo (vacío si el SQL no está pegado). */
interface LedgerSalaries {
  ready: boolean;
  salaries: Map<string, BarberSalary | null>;
  paid: Map<string, { amount: Prisma.Decimal; paidAt: Date }>;
}

const LEDGER_BARBER_SELECT = {
  id: true,
  name: true,
  nickname: true,
  isActive: true,
  commissionType: true,
  commissionPct: true,
  chairRent: true,
  createdAt: true,
} satisfies Prisma.BarberSelect;

type LedgerBarber = Prisma.BarberGetPayload<{ select: typeof LEDGER_BARBER_SELECT }>;

interface LedgerSale {
  id: string;
  barberId: string | null;
  subtotal: Prisma.Decimal;
  tip: Prisma.Decimal;
  notes: string | null;
  items: Array<{ serviceId: string | null; productId: string | null; description: string; qty: number; unitPrice: Prisma.Decimal }>;
}

interface LedgerEntry {
  id: string;
  barberId: string;
  saleId: string | null;
  base: Prisma.Decimal;
  amount: Prisma.Decimal;
  paidAt: Date | null;
}

async function loadLedger(
  db: Db,
  args: { barbershopId: string; barberIds: string[] | null; periodKey: string; tz: string },
): Promise<{ barbers: LedgerBarber[]; sales: LedgerSale[]; entries: LedgerEntry[]; salaries: LedgerSalaries; advances: AdvanceRow[] }> {
  const { start, end } = periodRange(args.periodKey, args.tz);
  const barberWhere: Prisma.BarberWhereInput = { barbershopId: args.barbershopId };
  if (args.barberIds) barberWhere.id = { in: args.barberIds };

  const [barbers, sales, entries] = await Promise.all([
    db.barber.findMany({
      where: barberWhere,
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: LEDGER_BARBER_SELECT,
    }),
    db.barberSale.findMany({
      where: {
        barbershopId: args.barbershopId,
        createdAt: { gte: start, lt: end },
        barberId: args.barberIds ? { in: args.barberIds } : { not: null },
      },
      select: {
        id: true,
        barberId: true,
        subtotal: true,
        tip: true,
        notes: true,
        items: { select: { serviceId: true, productId: true, description: true, qty: true, unitPrice: true } },
      },
    }),
    db.barberCommissionEntry.findMany({
      where: {
        barbershopId: args.barbershopId,
        periodKey: args.periodKey,
        ...(args.barberIds ? { barberId: { in: args.barberIds } } : {}),
      },
      select: { id: true, barberId: true, saleId: true, base: true, amount: true, paidAt: true },
    }),
  ]);
  const salaries: LedgerSalaries = { ready: false, salaries: new Map(), paid: new Map() };
  if (barbers.length > 0 && (await salaryReady(db))) {
    const ids = barbers.map((b) => b.id);
    salaries.ready = true;
    salaries.salaries = await loadSalaries(db, ids);
    salaries.paid = await loadSalaryPaid(db, { barbershopId: args.barbershopId, barberIds: ids, periodKey: args.periodKey });
  }
  // Adelantos/vales del periodo dados desde Caja (caja completa): se restan solos.
  const advances =
    barbers.length > 0 && (await cashMovementsReady(db))
      ? await loadAdvances(db, { barbershopId: args.barbershopId, barberIds: barbers.map((b) => b.id), periodKey: args.periodKey })
      : [];
  return { barbers, sales, entries, salaries, advances };
}

/** Fila del barbero + los ids de las entradas que un pago marcaría ahora. */
function ledgerRowFor(
  b: LedgerBarber,
  sales: LedgerSale[],
  entries: LedgerEntry[],
  sal: { salaries: LedgerSalaries; periodKey: string; advances?: AdvanceRow[]; /** Zona de la barbería: para saber en qué DÍA se dio de alta al barbero. */ tz: string },
): {
  row: CommissionSummaryRow;
  pendingEntryIds: string[];
  salaryDue: { amount: Money; approx: boolean; salary: BarberSalary } | null;
  /** Adelantos vivos y aún sin descontar que el siguiente pago descuenta. */
  pendingAdvanceIds: string[];
} {
  let ticketCount = 0;
  let services = ZERO;
  let products = ZERO;
  let adjustments = ZERO;
  let produced = ZERO;
  let tips = ZERO;
  let tipsPaid = ZERO;
  let base = ZERO;
  let total = ZERO;
  let paid = ZERO;
  let pending = ZERO;
  let paidCount = 0;
  let lastPaidAt: Date | null = null;
  const pendingEntryIds: string[] = [];

  // Un ticket está «pagado al barbero» cuando lo está su entrada de comisión.
  const paidSaleIds = new Set<string>();
  for (const e of entries) {
    if (e.barberId !== b.id) continue;
    base = base.plus(D(e.base));
    total = total.plus(D(e.amount));
    if (e.paidAt) {
      paidCount += 1;
      paid = paid.plus(D(e.amount));
      if (e.saleId) paidSaleIds.add(e.saleId);
      if (!lastPaidAt || e.paidAt > lastPaidAt) lastPaidAt = e.paidAt;
    } else {
      pending = pending.plus(D(e.amount));
      pendingEntryIds.push(e.id);
    }
  }
  const entryCount = paidCount + pendingEntryIds.length;

  for (const s of sales) {
    if (s.barberId !== b.id || isSaleCancelled(s)) continue;
    ticketCount += 1;
    tips = tips.plus(D(s.tip));
    if (paidSaleIds.has(s.id)) tipsPaid = tipsPaid.plus(D(s.tip));
    let depositCredit = ZERO;
    for (const it of s.items) {
      const t = lineTotal(it);
      if (it.serviceId) services = services.plus(t);
      else if (it.productId) products = products.plus(t);
      // El anticipo aplicado no es un descuento ni baja la producción del
      // barbero: el servicio se hizo completo (la otra parte ya se cobró).
      else if (isDepositLine(it.description)) depositCredit = depositCredit.plus(t);
      else adjustments = adjustments.plus(t);
    }
    produced = produced.plus(D(s.subtotal)).minus(depositCredit);
  }
  const tipsPending = tips.minus(tipsPaid);

  // Decisión 3 del QA E (16-nov-2026): renta y sueldo cuentan desde el ALTA del
  // barbero. El mes de su alta sale proporcional (por días de ese mes) y los
  // meses anteriores, en $0.
  const altaDay = dayKeyOf(b.createdAt, sal.tz);
  const periodDays = periodKeyDays(sal.periodKey);
  let chairRent: Money | null = null;
  let chairRentApprox = false;
  if (b.commissionType === "CHAIR_RENT") {
    // OJO (límite conocido): la renta descontada en un pago no se guarda en
    // ningún lado; se recalcula. Un mes de ALTA que ya se había liquidado con
    // la renta completa antes de esta regla se verá ahora con la proporcional
    // (su «Ya pagado» cambia por la diferencia). No se usa una fecha de corte:
    // no hay forma de que coincida con el momento real del despliegue.
    const r = chairRentForRange(b.chairRent, periodDays.from, periodDays.to, altaDay);
    chairRent = money(r.amount);
    chairRentApprox = r.approx;
  }

  // Sueldo del periodo (ws6-t6): cuenta SOLO si hoy cobra por Sueldo.
  const savedSalary = sal.salaries.salaries.get(b.id) ?? null;
  const salary = activeSalary(b.commissionType, savedSalary);
  const salaryOfPeriod = salary ? salaryForPeriodKey(salary, sal.periodKey, altaDay) : null;
  const salaryPaidRow = salary ? sal.salaries.paid.get(b.id) ?? null : null;

  const split = splitPayout(b.commissionType, {
    commissionPending: pending,
    commissionPaid: paid,
    tipsPending,
    tipsPaid,
    chairRent,
    anyPaid: paidCount > 0,
    salary: salaryOfPeriod ? salaryOfPeriod.amount : null,
    salaryPaid: salaryPaidRow ? salaryPaidRow.amount : null,
  });
  const salaryPending = salaryOfPeriod && !salaryPaidRow ? money(salaryOfPeriod.amount) : null;

  // Adelantos/vales (caja completa, ws6-t1): ya se le entregaron, así que se
  // RESTAN SOLOS de «a pagar» y cuentan como ya pagado. Uno ya descontado en
  // un pago anterior no se vuelve a restar (queda dentro de lo pagado).
  let advancesPending = ZERO;
  let advancesSettled = ZERO;
  const pendingAdvanceIds: string[] = [];
  for (const a of sal.advances ?? []) {
    if (a.barberId !== b.id) continue;
    if (a.settledAt) advancesSettled = advancesSettled.plus(a.amount);
    else {
      advancesPending = advancesPending.plus(a.amount);
      pendingAdvanceIds.push(a.id);
    }
  }
  const toPayNet = money(split.toPay.minus(advancesPending));
  const paidNet = money(split.paid.plus(advancesPending));
  if (salaryPaidRow && (!lastPaidAt || salaryPaidRow.paidAt > lastPaidAt)) lastPaidAt = salaryPaidRow.paidAt;

  const row: CommissionSummaryRow = {
    barberId: b.id,
    barberName: b.name,
    nickname: b.nickname,
    isActive: b.isActive,
    commissionType: b.commissionType,
    commissionPct: b.commissionPct === null ? null : toNum(b.commissionPct),
    chairRent: chairRent === null ? null : toNum(chairRent),
    chairRentMonthly: b.commissionType === "CHAIR_RENT" && b.chairRent !== null ? toNum(b.chairRent) : null,
    chairRentApprox,
    hiredInPeriod: hiredInside(sal.periodKey, altaDay),
    ticketCount,
    servicesTotal: toNum(services),
    productsTotal: toNum(products),
    adjustmentsTotal: toNum(adjustments),
    produced: toNum(produced),
    tips: toNum(tips),
    commissionBase: toNum(base),
    commissionTotal: toNum(total),
    commissionPaid: toNum(paid),
    commissionPending: toNum(pending),
    tipsPaid: toNum(tipsPaid),
    tipsPending: toNum(tipsPending),
    chairRentDiscounted: split.rentDiscounted,
    chairRentPending: split.rentPending === null ? null : toNum(split.rentPending),
    salaryAmount: savedSalary ? savedSalary.amount : null,
    salaryPeriod: savedSalary ? savedSalary.period : null,
    salaryPeriodTotal: salaryOfPeriod ? toNum(salaryPaidRow ? salaryPaidRow.amount : salaryOfPeriod.amount) : null,
    salaryApprox: salaryOfPeriod ? salaryOfPeriod.approx : false,
    salaryPending: salaryOfPeriod ? toNum(salaryPending ?? ZERO) : null,
    salaryPaid: salaryPaidRow ? toNum(salaryPaidRow.amount) : null,
    totalToPay: toNum(toPayNet),
    paidTotal: toNum(paidNet),
    periodTotal: toNum(toPayNet.plus(paidNet)),
    grossToPay: toNum(split.toPay),
    advances: toNum(advancesPending),
    advancesSettled: toNum(advancesSettled),
    paidStatus: paidStatusOf({
      entryCount,
      pendingCount: pendingEntryIds.length,
      paidCount,
      pendingAmount: pending.plus(tipsPending),
      salary: salaryOfPeriod && salaryOfPeriod.amount.gt(0) ? { pending: salaryPending !== null } : null,
    }),
    lastPaidAt: lastPaidAt ? lastPaidAt.toISOString() : null,
    entryCount,
  };
  const salaryDue =
    salary && salaryOfPeriod && salaryPending !== null && salaryPending.gt(0)
      ? { amount: salaryPending, approx: salaryOfPeriod.approx, salary }
      : null;
  return { row, pendingEntryIds, salaryDue, pendingAdvanceIds };
}

export async function getCommissionSummary(
  ctx: BarberContext,
  periodKey: string,
  opts: { barberId?: string | null } = {},
): Promise<CommissionSummary> {
  // N4: si se quitó el SQL de caja completa, se reintenta ya sin adelantos.
  return retryIfCajaSqlGone(() => getCommissionSummaryOnce(ctx, periodKey, opts));
}

async function getCommissionSummaryOnce(
  ctx: BarberContext,
  periodKey: string,
  opts: { barberId?: string | null } = {},
): Promise<CommissionSummary> {
  assertBarberPermission(ctx, "commissions.view");
  const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
  if (!isValidPeriodKey(periodKey)) {
    throw new BarberCajaError(400, "INVALID_PERIOD", "Periodo inválido (usa YYYY-MM)");
  }
  const scope = resolveCommissionScope(ctx, opts.barberId);
  const barbershopId = ctx.barbershopId;
  const policy = await getCommissionPolicy(barbershopId);

  const { barbers, sales, entries, salaries, advances } = await loadLedger(prisma, {
    barbershopId,
    barberIds: scope.barberIds,
    periodKey,
    tz,
  });
  const rows = barbers.map((b) => ledgerRowFor(b, sales, entries, { salaries, periodKey, advances, tz }).row);

  const totals = rows.reduce(
    (t, r) => ({
      produced: t.produced.plus(r.produced),
      tips: t.tips.plus(r.tips),
      commissionTotal: t.commissionTotal.plus(r.commissionTotal),
      commissionPending: t.commissionPending.plus(r.commissionPending),
      totalToPay: t.totalToPay.plus(r.totalToPay),
      paidTotal: t.paidTotal.plus(r.paidTotal),
    }),
    { produced: ZERO, tips: ZERO, commissionTotal: ZERO, commissionPending: ZERO, totalToPay: ZERO, paidTotal: ZERO },
  );

  return {
    periodKey,
    timezone: tz,
    policy,
    selfOnly: scope.selfOnly,
    rows,
    totals: {
      produced: toNum(totals.produced),
      tips: toNum(totals.tips),
      commissionTotal: toNum(totals.commissionTotal),
      commissionPending: toNum(totals.commissionPending),
      totalToPay: toNum(totals.totalToPay),
      paidTotal: toNum(totals.paidTotal),
    },
  };
}

export interface CommissionEntryRow extends BarberCommissionEntryDTO {
  createdAt: string;
  saleTotal: number | null;
  saleTip: number | null;
  salePaymentMethod: BarberPaymentMethod | null;
  saleCancelled: boolean;
  clientName: string | null;
  itemsSummary: string | null;
  /**
   * El ticket trae un corte cubierto por membresía o gratis por lealtad: se
   * cobró en $0 pero comisiona sobre el precio normal del servicio (por eso
   * la base puede ser mayor que el total del ticket).
   */
  coveredCut: boolean;
}

export function toCommissionEntryDTO(e: {
  id: string;
  barberId: string;
  saleId: string | null;
  appointmentId: string | null;
  base: Prisma.Decimal;
  pct: Prisma.Decimal | null;
  amount: Prisma.Decimal;
  periodKey: string;
  paidAt: Date | null;
}): BarberCommissionEntryDTO {
  return {
    id: e.id,
    barberId: e.barberId,
    saleId: e.saleId,
    appointmentId: e.appointmentId,
    base: toNum(e.base),
    pct: e.pct === null ? null : toNum(e.pct),
    amount: toNum(e.amount),
    periodKey: e.periodKey,
    paidAt: e.paidAt ? e.paidAt.toISOString() : null,
  };
}

/** Entradas (una por venta) de un barbero en el periodo, con el ticket. */
export async function getCommissionEntries(
  ctx: BarberContext,
  params: { periodKey: string; barberId: string },
): Promise<CommissionEntryRow[]> {
  assertBarberPermission(ctx, "commissions.view");
  if (!isValidPeriodKey(params.periodKey)) {
    throw new BarberCajaError(400, "INVALID_PERIOD", "Periodo inválido (usa YYYY-MM)");
  }
  const scope = resolveCommissionScope(ctx, params.barberId);
  if (scope.barberIds && scope.barberIds.length === 0) return [];

  const entries = await prisma.barberCommissionEntry.findMany({
    where: { barbershopId: ctx.barbershopId, barberId: params.barberId, periodKey: params.periodKey },
    orderBy: { createdAt: "asc" },
    include: {
      sale: {
        select: {
          total: true,
          tip: true,
          paymentMethod: true,
          notes: true,
          client: { select: { name: true } },
          items: { select: { description: true, qty: true } },
        },
      },
    },
  });
  return entries.map((e) => ({
    ...toCommissionEntryDTO(e),
    createdAt: e.createdAt.toISOString(),
    saleTotal: e.sale ? toNum(e.sale.total) : null,
    saleTip: e.sale ? toNum(e.sale.tip) : null,
    salePaymentMethod: e.sale ? e.sale.paymentMethod : null,
    saleCancelled: e.sale ? isSaleCancelled(e.sale) : false,
    clientName: e.sale?.client?.name ?? null,
    itemsSummary: e.sale
      ? e.sale.items.map((it) => (it.qty > 1 ? `${it.qty}× ${it.description}` : it.description)).join(", ") || null
      : null,
    coveredCut: e.sale ? e.sale.items.some((it) => isMembershipLine(it.description) || isLoyaltyFreeLine(it.description)) : false,
  }));
}

export interface CommissionPayoutResult {
  /** Entradas (tickets) que este pago marcó. 0 = no había nada pendiente. */
  marked: number;
  paidAt: string;
  /** Lo que cubrió ESTE pago: el «a pagar» que había justo antes de marcar. */
  paidAmount: number;
  /**
   * Movimiento de caja que se creó con el pago («sale de la caja», caja
   * completa ws6-t1). null = el pago no se registró en caja (o no había nada
   * que entregar: «a pagar» ≤ 0).
   */
  movementId?: string | null;
  /**
   * Registro «fuera de caja» del pago (decisión 1 del QA E, 16-nov-2026): se
   * marcó pagado SIN «sale de la caja» y aun así queda su movimiento, sin
   * turno y por un medio que no es efectivo, para que «Pagado» de Reportes dé
   * lo mismo que «Ya pagado» de Comisiones. null = no aplica (salió de la
   * caja, no había nada que entregar o falta el SQL de caja completa).
   */
  outsideMovementId?: string | null;
  /** Adelantos/vales del periodo que este pago descontó (ya se le habían entregado). */
  advancesDeducted?: number;
}

/** Cómo sale el dinero del pago, si se registra en Caja (caja completa). */
export interface CommissionCashOut {
  method: CashMovementMethod;
}

/**
 * Medio del registro «fuera de caja» de un pago marcado sin «sale de la caja»:
 * nunca efectivo (el efectivo del cajón solo sale con la casilla marcada).
 */
export const OUTSIDE_PAYOUT_METHOD: CashMovementMethod = "OTHER";

/**
 * Paga lo PENDIENTE del barbero en el periodo: marca (paidAt = ahora) todas
 * sus entradas sin pagar y devuelve cuánto cubrió el pago — la misma cifra
 * «a pagar» que enseñan la tabla, el diálogo y el recibo (ledgerRowFor).
 *
 * No paga doble:
 *  · un candado por barbero+periodo pone en fila dos clics simultáneos; el
 *    segundo ya no encuentra nada pendiente (marked 0, paidAmount 0);
 *  · solo se marcan las entradas que se LEYERON como pendientes dentro de la
 *    transacción: un ticket que entra justo después queda para el siguiente
 *    pago, no se cuela en este sin haberse mostrado;
 *  · `expectedTotal` (lo que la pantalla le enseñó a quien paga): si ya no
 *    coincide con lo pendiente, 409 PAYOUT_CHANGED y no se marca nada.
 *
 * Requiere commissions.manage y NO ser rol Barbero (D2, 16-nov: ni con el
 * permiso dado a mano); el barbero debe ser de ESTA barbería.
 */
export async function markCommissionsPaid(
  ctx: BarberContext,
  params: { barberId: string; periodKey: string; expectedTotal?: unknown },
  now: Date = new Date(),
  opts: {
    cashOut?: CommissionCashOut | null;
    /**
     * Renta de silla (o adelantos) con saldo a favor del dueño: el barbero
     * entrega la diferencia y «entra a la caja en efectivo» (revisión ws6-t8,
     * N3). Crea una entrada (DEPOSIT) ligada al pago. Pide cash.expenses.
     */
    cashIn?: boolean;
  } = {},
): Promise<CommissionPayoutResult> {
  assertBarberPermission(ctx, "commissions.manage");
  if (!canMarkCommissionsPaid({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride })) {
    throw new BarberForbiddenError("commissions.manage");
  }
  // «Sale de la caja» (caja completa): además pide sacar efectivo y el SQL.
  const cashOut = opts.cashOut ?? null;
  if (cashOut) {
    assertBarberPermission(ctx, "cash.withdraw");
    if (!isCashMovementMethod(cashOut.method)) throw new BarberCajaError(400, "INVALID_METHOD", "¿Con qué se pagó? Efectivo, tarjeta, transferencia u otro.");
    if (!(await cashMovementsReady(prisma))) {
      throw new BarberCajaError(409, "CAJA_SQL_PENDING", "Falta aplicar sql/barber_caja_completa.sql: el pago no se puede registrar en Caja.");
    }
  }
  // Sin «sale de la caja»: el pago se anota igual, FUERA de caja, si el SQL de
  // caja completa está pegado (decisión 1 del QA E). Sin él, como antes.
  const recordOutside = !cashOut && (await cashMovementsReady(prisma));
  const cashIn = opts.cashIn === true;
  if (cashIn) {
    assertBarberPermission(ctx, "cash.expenses");
    if (!(await cashMovementsReady(prisma))) {
      throw new BarberCajaError(409, "CAJA_SQL_PENDING", "Falta aplicar sql/barber_caja_completa.sql: la entrada no se puede registrar en Caja.");
    }
  }
  if (!isValidPeriodKey(params.periodKey)) {
    throw new BarberCajaError(400, "INVALID_PERIOD", "Periodo inválido (usa YYYY-MM)");
  }
  const barbershopId = ctx.barbershopId;
  const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
  let expected: Money | null = null;
  if (params.expectedTotal !== undefined && params.expectedTotal !== null) {
    if (typeof params.expectedTotal !== "number" || !Number.isFinite(params.expectedTotal)) {
      throw new BarberCajaError(400, "INVALID_AMOUNT", "expectedTotal: monto inválido");
    }
    expected = money(params.expectedTotal);
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dcb:pay:${barbershopId}:${params.barberId}:${params.periodKey}`}))`;

      const { barbers, sales, entries, salaries, advances } = await loadLedger(tx, {
        barbershopId,
        barberIds: [params.barberId],
        periodKey: params.periodKey,
        tz,
      });
      const barber = barbers[0];
      if (!barber) throw new BarberCajaError(404, "BARBER_NOT_FOUND", "Barbero no encontrado");

      const { row, pendingEntryIds, salaryDue, pendingAdvanceIds } = ledgerRowFor(barber, sales, entries, {
        salaries,
        periodKey: params.periodKey,
        advances,
        tz,
      });
      if (pendingEntryIds.length === 0 && !salaryDue) {
        return { marked: 0, paidAt: now.toISOString(), paidAmount: 0, movementId: null, outsideMovementId: null, advancesDeducted: 0 };
      }
      if (expected !== null && !expected.equals(money(row.totalToPay))) {
        throw new BarberCajaError(
          409,
          "PAYOUT_CHANGED",
          `Lo pendiente cambió mientras tenías la pantalla abierta: ahora son ${money(row.totalToPay).toFixed(2)}. Revisa la cifra y vuelve a marcar.`,
          { totalToPay: row.totalToPay },
        );
      }

      const r =
        pendingEntryIds.length > 0
          ? await tx.barberCommissionEntry.updateMany({
              where: { id: { in: pendingEntryIds }, barbershopId, barberId: params.barberId, paidAt: null },
              data: { paidAt: now },
            })
          : { count: 0 };
      // El sueldo del periodo se paga en el MISMO pago (mismo candado y misma transacción).
      let salaryMarked = false;
      if (salaryDue) {
        salaryMarked = await insertSalaryPayment(tx, {
          id: randomUUID(),
          barbershopId,
          barberId: params.barberId,
          periodKey: params.periodKey,
          amount: salaryDue.amount,
          approx: salaryDue.approx,
          salary: salaryDue.salary,
          paidAt: now,
          paidByUserId: ctx.barberUserId ?? null,
        });
      }
      // Los adelantos vivos del periodo quedan DESCONTADOS en este pago (con su
      // hora): no se vuelven a restar. Si uno se anuló entretanto, nada se paga.
      if (pendingAdvanceIds.length > 0) {
        const settled = await settleAdvances(tx, { barbershopId, ids: pendingAdvanceIds, at: now });
        if (settled !== pendingAdvanceIds.length) {
          throw new BarberCajaError(409, "PAYOUT_CHANGED", "Los adelantos cambiaron mientras tenías la pantalla abierta. Revisa la cifra y vuelve a marcar.");
        }
      }
      // Un solo pago = un solo registro (las entradas/sueldo marcados) + SU
      // movimiento de caja, en la MISMA transacción: si no hay caja abierta
      // para pagar en efectivo, no se marca nada.
      let movementId: string | null = null;
      if (cashOut && money(row.totalToPay).gt(ZERO)) {
        const session = await lockOpenSessionShared(tx, barbershopId);
        if (!session && cashOut.method === "CASH") {
          throw new BarberCajaError(409, "NO_OPEN_SESSION", "No hay caja abierta: ábrela para pagar en efectivo desde la caja, o quita «sale de la caja».");
        }
        movementId = randomUUID();
        await insertMovement(tx, {
          id: movementId,
          barbershopId,
          sessionId: session?.id ?? null,
          type: "BARBER_PAYOUT",
          method: cashOut.method,
          amount: money(row.totalToPay),
          category: null,
          note: null,
          barberId: params.barberId,
          payoutKind: barber.commissionType === "SALARY" ? "SALARY" : "COMMISSION",
          periodKey: params.periodKey,
          receiptUrl: null,
          createdByUserId: ctx.barberUserId,
          createdAt: now,
        });
      }
      // Decisión 1 del QA E (16-nov-2026): marcado SIN «sale de la caja», el
      // pago deja igual UN registro, «fuera de caja»: sin turno (no entra a
      // ningún corte) y por un medio que NO es efectivo (no mueve el cajón ni
      // el esperado). Va ligado como el de caja —mismo barbero, periodo y hora
      // del pago—, así que anularlo deshace el pago. Con él, lo «Pagado» de
      // Reportes es lo «Ya pagado» de Comisiones. No pide cash.withdraw: no
      // sale nada de la caja.
      let outsideMovementId: string | null = null;
      if (recordOutside && money(row.totalToPay).gt(ZERO)) {
        outsideMovementId = randomUUID();
        await insertMovement(tx, {
          id: outsideMovementId,
          barbershopId,
          sessionId: null,
          type: "BARBER_PAYOUT",
          method: OUTSIDE_PAYOUT_METHOD,
          amount: money(row.totalToPay),
          category: null,
          note: null,
          barberId: params.barberId,
          payoutKind: barber.commissionType === "SALARY" ? "SALARY" : "COMMISSION",
          periodKey: params.periodKey,
          receiptUrl: null,
          createdByUserId: ctx.barberUserId,
          createdAt: now,
        });
      }
      // Saldo a favor del dueño (renta de silla, o adelantos mayores que lo
      // ganado): lo que el barbero entrega ENTRA al cajón, ligado a este pago.
      if (cashIn && money(row.totalToPay).lt(ZERO)) {
        const session = await lockOpenSessionShared(tx, barbershopId);
        if (!session) {
          throw new BarberCajaError(409, "NO_OPEN_SESSION", "No hay caja abierta: ábrela para que el efectivo entre a la caja, o quita «entra a la caja».");
        }
        movementId = randomUUID();
        await insertMovement(tx, {
          id: movementId,
          barbershopId,
          sessionId: session.id,
          type: "DEPOSIT",
          method: "CASH",
          amount: money(row.totalToPay).abs(),
          category: null,
          note: null,
          barberId: params.barberId,
          payoutKind: null,
          periodKey: params.periodKey,
          receiptUrl: null,
          createdByUserId: ctx.barberUserId,
          createdAt: now,
        });
      }
      return {
        marked: r.count + (salaryMarked ? 1 : 0),
        paidAt: now.toISOString(),
        // Lo que de verdad se le entrega: el «a pagar» ya sin los adelantos.
        paidAmount: row.totalToPay,
        movementId,
        outsideMovementId,
        advancesDeducted: row.advances ?? 0,
      };
    },
    { maxWait: 5000, timeout: 15000 },
  );
}

/**
 * Deshace un pago de comisión ligado a Caja (revisión ws6-t8, N2): dentro de
 * la transacción de quien anula el movimiento, con el MISMO candado del pago.
 * Las entradas de comisión de ese pago (paidAt = la hora del pago) vuelven a
 * quedar pendientes y los adelantos que descontó vuelven a restarse.
 *
 * NO deshace un pago que incluyó SUELDO: el sueldo pagado es un renglón de
 * barber_salary_payments (uno por barbero y periodo) y deshacerlo sería
 * borrarlo. En ese caso, 409 SALARY_PAID_NOT_UNDOABLE y no se toca nada.
 */
export async function undoCommissionPaymentTx(
  tx: Prisma.TransactionClient,
  ctx: BarberContext,
  p: { barberId: string; periodKey: string; paidAt: Date },
): Promise<{ unmarked: number; advancesRestored: number }> {
  if (!canMarkCommissionsPaid({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride })) {
    throw new BarberForbiddenError("commissions.manage");
  }
  const barbershopId = ctx.barbershopId;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dcb:pay:${barbershopId}:${p.barberId}:${p.periodKey}`}))`;
  if (await salaryReady(tx)) {
    const sal = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS "n" FROM "barber_salary_payments"
      WHERE "barbershopId" = ${barbershopId} AND "barberId" = ${p.barberId} AND "periodKey" = ${p.periodKey} AND "paidAt" = ${p.paidAt}
    `;
    if (Number(sal[0]?.n ?? 0) > 0) {
      throw new BarberCajaError(
        409,
        "SALARY_PAID_NOT_UNDOABLE",
        "Ese pago incluyó el sueldo del periodo y el sueldo pagado no se puede deshacer desde Caja. Corrígelo con un movimiento de caja y una nota.",
      );
    }
  }
  const r = await tx.barberCommissionEntry.updateMany({
    where: { barbershopId, barberId: p.barberId, periodKey: p.periodKey, paidAt: p.paidAt },
    data: { paidAt: null },
  });
  const advancesRestored = await unsettleAdvances(tx, { barbershopId, barberId: p.barberId, periodKey: p.periodKey, at: p.paidAt });
  return { unmarked: r.count, advancesRestored };
}

/** Recibo imprimible: resumen del barbero + sus entradas del periodo. */
export async function getCommissionReceipt(
  ctx: BarberContext,
  params: { barberId: string; periodKey: string },
): Promise<{ summary: CommissionSummary; row: CommissionSummaryRow; entries: CommissionEntryRow[] } | null> {
  const summary = await getCommissionSummary(ctx, params.periodKey, { barberId: params.barberId });
  const row = summary.rows.find((r) => r.barberId === params.barberId);
  if (!row) return null;
  const entries = await getCommissionEntries(ctx, params);
  return { summary, row, entries };
}
