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
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertBarberPermission, type BarberContext } from "@/lib/barber-auth";
import type {
  BarberCommissionEntryDTO,
  BarberCommissionType,
  BarberPaymentMethod,
} from "@/lib/barber/types";

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
  parts: { commissionTotal: Money; tips: Money; chairRent: Money | null },
): Money {
  switch (type) {
    case "COMMISSION":
      return money(parts.commissionTotal.plus(parts.tips));
    case "CHAIR_RENT":
      return money(parts.commissionTotal.minus(parts.chairRent ?? ZERO).plus(parts.tips));
    case "SALARY":
    default:
      return money(parts.tips);
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
  chairRent: number | null;
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
  totalToPay: number;
  paidStatus: CommissionPaidStatus;
  lastPaidAt: string | null;
  entryCount: number;
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
    totalToPay: number;
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

function paidStatusOf(entryCount: number, pending: Money, paid: Money): CommissionPaidStatus {
  if (entryCount === 0) return "EMPTY";
  if (pending.isZero() && !paid.isZero()) return "PAID";
  if (!pending.isZero() && !paid.isZero()) return "PARTIAL";
  if (pending.isZero() && paid.isZero()) return "PAID"; // solo entradas de $0 (sueldo)
  return "PENDING";
}

export async function getCommissionSummary(
  ctx: BarberContext,
  periodKey: string,
  opts: { barberId?: string | null } = {},
): Promise<CommissionSummary> {
  assertBarberPermission(ctx, "commissions.view");
  const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
  const { start, end } = periodRange(periodKey, tz);
  const scope = resolveCommissionScope(ctx, opts.barberId);
  const barbershopId = ctx.barbershopId;
  const policy = await getCommissionPolicy(barbershopId);

  const barberWhere: Prisma.BarberWhereInput = { barbershopId };
  if (scope.barberIds) barberWhere.id = { in: scope.barberIds };

  const [barbers, sales, entries] = await Promise.all([
    prisma.barber.findMany({
      where: barberWhere,
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        nickname: true,
        isActive: true,
        commissionType: true,
        commissionPct: true,
        chairRent: true,
      },
    }),
    prisma.barberSale.findMany({
      where: {
        barbershopId,
        createdAt: { gte: start, lt: end },
        barberId: scope.barberIds ? { in: scope.barberIds } : { not: null },
      },
      select: {
        id: true,
        barberId: true,
        subtotal: true,
        tip: true,
        notes: true,
        items: { select: { serviceId: true, productId: true, qty: true, unitPrice: true } },
      },
    }),
    prisma.barberCommissionEntry.findMany({
      where: {
        barbershopId,
        periodKey,
        ...(scope.barberIds ? { barberId: { in: scope.barberIds } } : {}),
      },
      select: { barberId: true, base: true, amount: true, paidAt: true },
    }),
  ]);

  type Acc = {
    ticketCount: number;
    services: Money;
    products: Money;
    adjustments: Money;
    produced: Money;
    tips: Money;
    base: Money;
    total: Money;
    paid: Money;
    pending: Money;
    entryCount: number;
    lastPaidAt: Date | null;
  };
  const acc = new Map<string, Acc>();
  const get = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = {
        ticketCount: 0,
        services: ZERO,
        products: ZERO,
        adjustments: ZERO,
        produced: ZERO,
        tips: ZERO,
        base: ZERO,
        total: ZERO,
        paid: ZERO,
        pending: ZERO,
        entryCount: 0,
        lastPaidAt: null,
      };
      acc.set(id, a);
    }
    return a;
  };

  for (const s of sales) {
    if (!s.barberId || isSaleCancelled(s)) continue;
    const a = get(s.barberId);
    a.ticketCount += 1;
    a.produced = a.produced.plus(D(s.subtotal));
    a.tips = a.tips.plus(D(s.tip));
    for (const it of s.items) {
      const t = lineTotal(it);
      if (it.serviceId) a.services = a.services.plus(t);
      else if (it.productId) a.products = a.products.plus(t);
      else a.adjustments = a.adjustments.plus(t);
    }
  }
  for (const e of entries) {
    const a = get(e.barberId);
    a.entryCount += 1;
    a.base = a.base.plus(D(e.base));
    a.total = a.total.plus(D(e.amount));
    if (e.paidAt) {
      a.paid = a.paid.plus(D(e.amount));
      if (!a.lastPaidAt || e.paidAt > a.lastPaidAt) a.lastPaidAt = e.paidAt;
    } else {
      a.pending = a.pending.plus(D(e.amount));
    }
  }

  const rows: CommissionSummaryRow[] = barbers.map((b) => {
    const a = get(b.id);
    const chairRent = b.commissionType === "CHAIR_RENT" ? money(b.chairRent ?? 0) : null;
    const totalToPay = payoutFor(b.commissionType, {
      commissionTotal: a.total,
      tips: a.tips,
      chairRent,
    });
    return {
      barberId: b.id,
      barberName: b.name,
      nickname: b.nickname,
      isActive: b.isActive,
      commissionType: b.commissionType,
      commissionPct: b.commissionPct === null ? null : toNum(b.commissionPct),
      chairRent: b.chairRent === null ? null : toNum(b.chairRent),
      ticketCount: a.ticketCount,
      servicesTotal: toNum(a.services),
      productsTotal: toNum(a.products),
      adjustmentsTotal: toNum(a.adjustments),
      produced: toNum(a.produced),
      tips: toNum(a.tips),
      commissionBase: toNum(a.base),
      commissionTotal: toNum(a.total),
      commissionPaid: toNum(a.paid),
      commissionPending: toNum(a.pending),
      totalToPay: toNum(totalToPay),
      paidStatus: paidStatusOf(a.entryCount, a.pending, a.paid),
      lastPaidAt: a.lastPaidAt ? a.lastPaidAt.toISOString() : null,
      entryCount: a.entryCount,
    };
  });

  const totals = rows.reduce(
    (t, r) => ({
      produced: t.produced.plus(r.produced),
      tips: t.tips.plus(r.tips),
      commissionTotal: t.commissionTotal.plus(r.commissionTotal),
      commissionPending: t.commissionPending.plus(r.commissionPending),
      totalToPay: t.totalToPay.plus(r.totalToPay),
    }),
    { produced: ZERO, tips: ZERO, commissionTotal: ZERO, commissionPending: ZERO, totalToPay: ZERO },
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
  }));
}

/**
 * Marca como pagadas TODAS las entradas pendientes del barbero en el periodo
 * (paidAt = ahora). Devuelve cuántas se marcaron. Requiere commissions.manage;
 * el barbero debe ser de ESTA barbería (updateMany scopeado → 0 filas si no).
 */
export async function markCommissionsPaid(
  ctx: BarberContext,
  params: { barberId: string; periodKey: string },
  now: Date = new Date(),
): Promise<{ marked: number; paidAt: string }> {
  assertBarberPermission(ctx, "commissions.manage");
  if (!isValidPeriodKey(params.periodKey)) {
    throw new BarberCajaError(400, "INVALID_PERIOD", "Periodo inválido (usa YYYY-MM)");
  }
  const barber = await prisma.barber.findFirst({
    where: { id: params.barberId, barbershopId: ctx.barbershopId },
    select: { id: true },
  });
  if (!barber) throw new BarberCajaError(404, "BARBER_NOT_FOUND", "Barbero no encontrado");

  const r = await prisma.barberCommissionEntry.updateMany({
    where: {
      barbershopId: ctx.barbershopId,
      barberId: params.barberId,
      periodKey: params.periodKey,
      paidAt: null,
    },
    data: { paidAt: now },
  });
  return { marked: r.count, paidAt: now.toISOString() };
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
