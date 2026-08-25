// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — estadísticas: el resumen del día (Inicio, todos los
// planes) y los reportes (Profesional, feature `analytics`).
//
// REGLAS DEL MÓDULO
//  · barbershopId sale SIEMPRE del BarberContext. El alcance multisede es el
//    de resolveBranchScope (branches.ts, punto único): la lista de sedes se
//    aplica como `IN (...)` y nunca puede quedar vacía ni undefined.
//  · Un rol BARBER ve SOLO lo suyo. El recorte lo hace resolveCommissionScope
//    (commissions.ts, el mismo que usa la nómina): sus ventas, sus visitas y
//    sus comisiones. Nunca el total de la barbería ni a otros barberos. Un
//    BARBER sin fila Barber ligada no ve dinero (barberIds = []).
//  · Dinero en Decimal. Los agregados se hacen EN LA BASE (SUM/COUNT/GROUP
//    BY); a JS solo llegan totales. Los SUM de Postgres vuelven como Decimal
//    y se redondean UNA vez con money() al armar el DTO.
//  · No se duplican reglas de negocio: el efectivo esperado del turno es
//    expectedCashFor (cash.ts) sobre el mismo agregado que hace la caja
//    (fondo + Σ total de tickets vivos en efectivo); el ticket cancelado es
//    CANCELLED_MARK / NOT_CANCELLED (commissions.ts / clients.ts); "por
//    cobrar" es la misma regla que las citas por cobrar de la caja (DONE sin
//    ticket vivo); la "visita" es la misma definición que clients.ts (cita
//    DONE o venta de mostrador con un servicio); el margen de un producto es
//    ingreso − qty × costo actual (inventory.ts).
//  · Rendimiento: Inicio se abre decenas de veces al día. Un solo
//    Promise.all de ≤ 6 lecturas por lote, sin N+1 y SIN `include`: Prisma
//    resuelve cada relación anidada con una sentencia aparte, así que las
//    lecturas con nombres relacionados (visitas de hoy, turno abierto) van en
//    SQL con JOIN y dejan UNA sentencia cada una (medido en la prueba de
//    integración: 6 sentencias para el dueño).
//  · Las fechas se cortan en la zona horaria de la barbería. Las columnas
//    son timestamp(3) SIN zona guardadas en UTC (así las crea Prisma y así
//    las crea sql/barber.sql), por eso el SQL hace
//    timezone(tz, timezone('UTC', col)) para pasar a hora local y los
//    límites se mandan como ISO → timestamptz → UTC naive (utcTs), que no
//    depende del TimeZone de la sesión de Postgres.
//
// Sin "server-only" a propósito (igual que cash.ts): las pruebas de
// integración lo importan con tsx contra Postgres real.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  BarberForbiddenError,
  hasBarberPermission,
  type BarberContext,
  type BarberPermissionKey,
} from "@/lib/barber-auth";
import { resolveBranchScope } from "@/lib/barber/branches";
import { expectedCashFor, resolveBarberFeatures } from "@/lib/barber/cash";
import {
  BarberCajaError,
  CANCELLED_MARK,
  D,
  DEFAULT_BARBER_TZ,
  ZERO,
  money,
  resolveCommissionScope,
  toNum,
  zonedMidnightUtc,
  zonedParts,
  type Money,
} from "@/lib/barber/commissions";
import { NOT_CANCELLED } from "@/lib/barber/clients";
import { BARBER_DEFAULT_DAY_END_MIN, BARBER_DEFAULT_DAY_START_MIN } from "@/lib/barber/agenda";
import type {
  BarberAppointmentStatus,
  BarberCommissionType,
  BarberPaymentMethod,
} from "@/lib/barber/types";

// ── Alcance (sede + rol) ────────────────────────────────────────────────

export interface StatsScope {
  /** Sedes que entran en TODAS las lecturas (`barbershopId IN`). Nunca vacío. */
  branchIds: string[];
  /** Sede elegida; null = vista consolidada de la cadena. */
  activeBranchId: string | null;
  accessible: string[];
  consolidated: boolean;
  canConsolidate: boolean;
  /** true = rol BARBER: solo ve lo suyo. */
  selfOnly: boolean;
  /** null = todos los barberos; [] = ninguno (BARBER sin fila ligada). */
  barberIds: string[] | null;
}

export interface StatsScopeInput {
  /** Sede pedida (cookie o query). "all" = consolidado. Se valida SIEMPRE. */
  branchId?: string | null;
  /** Filtro opcional por barbero. Un BARBER solo puede pedir el suyo (403). */
  barberId?: string | null;
}

/**
 * Sede + barbero, los dos ejes del alcance, resueltos por los puntos únicos
 * del vertical: resolveBranchScope (sedes que la sesión puede ver) y
 * resolveCommissionScope (un BARBER solo se ve a sí mismo).
 */
export async function resolveStatsScope(
  ctx: BarberContext,
  input: StatsScopeInput = {},
): Promise<StatsScope> {
  const branch = await resolveBranchScope(ctx, input.branchId ?? null);
  const barber = resolveCommissionScope(ctx, input.barberId ?? null);
  return {
    branchIds: branch.branchIds.length > 0 ? branch.branchIds : [ctx.barbershopId],
    activeBranchId: branch.activeId,
    accessible: branch.accessible,
    consolidated: branch.isConsolidated,
    canConsolidate: branch.canConsolidate,
    selfOnly: barber.selfOnly,
    barberIds: barber.barberIds,
  };
}

function permUserOf(ctx: BarberContext) {
  return { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
}

function can(ctx: BarberContext, key: BarberPermissionKey): boolean {
  return hasBarberPermission(permUserOf(ctx), key);
}

/** Reportes: ver el dinero de la barbería (cash.view) o el propio (commissions.view). */
export function canViewReports(ctx: BarberContext): boolean {
  return can(ctx, "cash.view") || can(ctx, "commissions.view");
}

export function assertReportsAccess(ctx: BarberContext): void {
  if (!canViewReports(ctx)) throw new BarberForbiddenError("cash.view");
}

// ── Fechas en la zona de la barbería ────────────────────────────────────

function tzOf(ctx: BarberContext): string {
  return ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
}

/** Medianoche (UTC instant) del día local de `now` desplazado `offsetDays`. */
export function shiftedDayStart(now: Date, tz: string, offsetDays: number): Date {
  const p = zonedParts(now, tz);
  return zonedMidnightUtc(p.y, p.m, p.d + offsetDays, tz);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "YYYY-MM-DD" del instante visto desde la zona de la barbería. */
export function dateKeyInTz(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

interface Ymd {
  y: number;
  m: number;
  d: number;
}

export function parseDateKey(value: unknown): Ymd | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

function ymdKey(v: Ymd): string {
  return `${v.y}-${pad2(v.m)}-${pad2(v.d)}`;
}

function ymdFromUtcDays(days: number): Ymd {
  const dt = new Date(days * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function ymdToUtcDays(v: Ymd): number {
  return Math.round(Date.UTC(v.y, v.m - 1, v.d) / 86_400_000);
}

/** Día de la semana (0 = domingo) de una fecha calendario. */
function weekdayOf(v: Ymd): number {
  return new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay();
}

// ── Fragmentos SQL ──────────────────────────────────────────────────────

/** Instante UTC como timestamp naive (la forma de las columnas), sin depender del TimeZone de la sesión. */
function utcTs(d: Date): Prisma.Sql {
  return Prisma.sql`timezone('UTC', ${d.toISOString()}::timestamptz)`;
}

/** Columna timestamp naive UTC → hora local de la barbería. */
function localTs(tz: string, column: string): Prisma.Sql {
  return Prisma.sql`timezone(${tz}, timezone('UTC', ${Prisma.raw(column)}))`;
}

/** Ticket vivo: la MISMA marca que isSaleCancelled / NOT_CANCELLED. */
function liveSale(alias: string): Prisma.Sql {
  const col = Prisma.raw(`${alias}."notes"`);
  return Prisma.sql`(${col} IS NULL OR ${col} NOT LIKE ${`${CANCELLED_MARK}%`})`;
}

/** Recorte por barbero para una columna dada; [] = nada (AND FALSE). */
function barberFilter(column: string, barberIds: string[] | null): Prisma.Sql {
  if (barberIds === null) return Prisma.empty;
  if (barberIds.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND ${Prisma.raw(column)} IN (${Prisma.join(barberIds)})`;
}

function barberWhere(barberIds: string[] | null): { barberId?: { in: string[] } } {
  return barberIds === null ? {} : { barberId: { in: barberIds } };
}

function intOf(v: unknown): number {
  const n = typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pctChange(current: Money, reference: Money): number | null {
  if (reference.isZero()) return null;
  return current.minus(reference).div(reference).times(100).toDecimalPlaces(1).toNumber();
}

function ratioPct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return new Prisma.Decimal(part).div(whole).times(100).toDecimalPlaces(1).toNumber();
}

// ═══════════════════════════════════════════════════════════════════════
// A. INICIO — el resumen del día
// ═══════════════════════════════════════════════════════════════════════

export interface InicioDayMoney {
  tickets: number;
  /** Σ subtotal (sin propina) = "Vendido" de la caja / "Producido" de comisiones. */
  revenue: number;
  tips: number;
  /** Σ total = revenue + tips (lo que entró). */
  total: number;
}

export interface InicioUpcoming {
  id: string;
  startAt: string;
  endAt: string;
  status: BarberAppointmentStatus;
  clientName: string | null;
  barberName: string | null;
  services: string;
}

export interface InicioCash {
  open: boolean;
  sessionId: string | null;
  openedAt: string | null;
  openedByName: string | null;
  /** fondo + Σ tickets en efectivo (summarizeSession). */
  expectedCash: number | null;
  openingAmount: number | null;
  ticketCount: number;
  salesTotal: number;
  tipsTotal: number;
}

export interface InicioAlerts {
  barbersNoSchedule: { count: number; names: string[] } | null;
  lowStock: { count: number; names: string[] } | null;
  membershipsSoon: number | null;
  tomorrowPending: number | null;
  tomorrowTotal: number | null;
  publicRequests: number | null;
}

export interface InicioSetup {
  hasBarbers: boolean;
  hasSchedules: boolean;
  hasServices: boolean;
  hasAppointments: boolean;
  hasSales: boolean;
  hasWeb: boolean;
  /** Sin una sola visita ni venta: la barbería acaba de empezar. */
  isFresh: boolean;
}

export interface InicioSummary {
  generatedAt: string;
  timezone: string;
  /** Día local que resume (YYYY-MM-DD). */
  date: string;
  scope: {
    branchIds: string[];
    activeBranchId: string | null;
    consolidated: boolean;
    canConsolidate: boolean;
    selfOnly: boolean;
    barberLinked: boolean;
  };
  can: {
    agenda: boolean;
    cash: boolean;
    cashManage: boolean;
    queue: boolean;
    reports: boolean;
    schedule: boolean;
    products: boolean;
    memberships: boolean;
    requests: boolean;
  };
  today: InicioDayMoney & { avgTicket: number | null };
  compare: {
    yesterday: InicioDayMoney;
    lastWeek: InicioDayMoney;
    vsYesterdayPct: number | null;
    vsLastWeekPct: number | null;
  };
  visits: {
    total: number;
    done: number;
    pending: number;
    inProgress: number;
    cancelled: number;
    noShow: number;
    /** Terminadas sin ticket vivo (misma regla que las "citas por cobrar" de la caja). */
    toCharge: number;
  } | null;
  upcoming: InicioUpcoming[];
  cash: InicioCash | null;
  queue: { waiting: number; called: number } | null;
  alerts: InicioAlerts;
  setup: InicioSetup;
}

interface DayMoneyRow {
  day: string;
  tickets: unknown;
  subtotal: unknown;
  tip: unknown;
  total: unknown;
}

interface TodayAppointmentRow {
  id: string;
  status: string;
  startAt: Date;
  endAt: Date;
  client_name: string | null;
  barber_name: string | null;
  services: string | null;
  charged: boolean;
}

interface OpenSessionRow {
  id: string;
  openedAt: Date;
  openingAmount: unknown;
  opened_by: string | null;
  tickets: unknown;
  sales_total: unknown;
  tips_total: unknown;
  cash_total: unknown;
}

interface AlertsRow {
  barbers_no_schedule: unknown;
  barbers_no_schedule_names: string | null;
  low_stock: unknown;
  low_stock_names: string | null;
  memberships_soon: unknown;
  tomorrow_pending: unknown;
  tomorrow_total: unknown;
  public_requests: unknown;
  has_barbers: boolean;
  has_schedules: boolean;
  has_services: boolean;
  has_appointments: boolean;
  has_sales: boolean;
  has_web: boolean;
}

function dayMoneyOf(row: DayMoneyRow | undefined): InicioDayMoney & { revenueDec: Money } {
  const revenueDec = money(D(row?.subtotal as never));
  return {
    tickets: intOf(row?.tickets),
    revenue: revenueDec.toNumber(),
    tips: toNum(D(row?.tip as never)),
    total: toNum(D(row?.total as never)),
    revenueDec,
  };
}

function splitNames(raw: string | null): string[] {
  return (raw ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface InicioOptions extends StatsScopeInput {
  /** Mapa de features del plan (getBarberPlan(...).features). Se resuelve si falta. */
  features?: Record<string, boolean>;
  now?: Date;
}

/**
 * Resumen del día para /barber/inicio. Lecturas a la base: UN lote de 5 en
 * paralelo (ventas por día, visitas de hoy con sus nombres, fila, avisos +
 * arranque en un solo SELECT, turno abierto con sus totales) más las 1-2 de
 * resolveBranchScope. Nada se lee por fila.
 */
export async function getInicioSummary(ctx: BarberContext, opts: InicioOptions = {}): Promise<InicioSummary> {
  const now = opts.now ?? new Date();
  const tz = tzOf(ctx);
  const features = opts.features ?? (await resolveBarberFeatures(ctx));
  const scope = await resolveStatsScope(ctx, opts);
  const { branchIds, barberIds, selfOnly } = scope;

  const todayStart = shiftedDayStart(now, tz, 0);
  const tomorrowStart = shiftedDayStart(now, tz, 1);
  const dayAfterStart = shiftedDayStart(now, tz, 2);
  const weekAgoStart = shiftedDayStart(now, tz, -7);
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
  const todayKey = dateKeyInTz(now, tz);
  const yesterdayKey = dateKeyInTz(shiftedDayStart(now, tz, -1), tz);
  const weekAgoKey = dateKeyInTz(weekAgoStart, tz);

  const canAgenda = can(ctx, "agenda.view");
  const canCash = features.cash === true && can(ctx, "cash.view") && !selfOnly;
  const canQueue = features.walkinQueue === true && can(ctx, "walkin.manage");
  const canSchedule = can(ctx, "schedule.manage") || can(ctx, "barbers.manage");
  const canProducts = features.products === true && can(ctx, "products.manage");
  const canMemberships = features.memberships === true && can(ctx, "memberships.manage");
  const canRequests = features.publicBooking === true && can(ctx, "requests.manage");
  const canReports = features.analytics === true && canViewReports(ctx);

  const ids = Prisma.join(branchIds);
  const cashShopId = scope.activeBranchId ?? ctx.barbershopId;

  const [dayRows, todayAppointments, queueGroups, alertsRows, openSessionRows] = await Promise.all([
    prisma.$queryRaw<DayMoneyRow[]>`
      SELECT to_char(${localTs(tz, 's."createdAt"')}, 'YYYY-MM-DD') AS day,
             COUNT(*) FILTER (WHERE ${liveSale("s")})::int AS tickets,
             COALESCE(SUM(s."subtotal"), 0) AS subtotal,
             COALESCE(SUM(s."tip"), 0) AS tip,
             COALESCE(SUM(s."total"), 0) AS total
      FROM "barber_sales" s
      WHERE s."barbershopId" IN (${ids})
        AND s."createdAt" >= ${utcTs(weekAgoStart)}
        AND s."createdAt" < ${utcTs(tomorrowStart)}
        ${barberFilter('s."barberId"', barberIds)}
      GROUP BY 1
    `,
    // Visitas de HOY con cliente, barbero, servicios y si ya tienen ticket
    // vivo — en UNA sentencia (un `include` de Prisma serían seis).
    canAgenda
      ? prisma.$queryRaw<TodayAppointmentRow[]>`
          SELECT a."id", a."status"::text AS status, a."startAt", a."endAt",
                 COALESCE(c."name", a."clientName") AS client_name,
                 COALESCE(NULLIF(b."nickname", ''), b."name") AS barber_name,
                 (SELECT string_agg(sv."name", ', ' ORDER BY sv."name")
                    FROM "barber_appointment_services" aps
                    JOIN "barber_services" sv ON sv."id" = aps."serviceId"
                   WHERE aps."appointmentId" = a."id") AS services,
                 EXISTS (SELECT 1 FROM "barber_sales" s WHERE s."appointmentId" = a."id" AND ${liveSale("s")}) AS charged
          FROM "barber_appointments" a
          LEFT JOIN "barber_clients" c ON c."id" = a."clientId"
          LEFT JOIN "barber_barbers" b ON b."id" = a."barberId"
          WHERE a."barbershopId" IN (${ids})
            AND a."startAt" >= ${utcTs(todayStart)} AND a."startAt" < ${utcTs(tomorrowStart)}
            ${barberFilter('a."barberId"', barberIds)}
          ORDER BY a."startAt" ASC
        `
      : Promise.resolve([] as TodayAppointmentRow[]),
    canQueue
      ? prisma.barberWalkIn.groupBy({
          by: ["status"],
          where: { barbershopId: { in: branchIds }, status: { in: ["WAITING", "CALLED"] } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    prisma.$queryRaw<AlertsRow[]>`
      SELECT
        (SELECT COUNT(*)::int FROM "barber_barbers" b
           WHERE b."barbershopId" IN (${ids}) AND b."isActive" = TRUE
             AND NOT EXISTS (SELECT 1 FROM "barber_schedules" sc WHERE sc."barberId" = b."id" AND sc."isActive" = TRUE)
        ) AS barbers_no_schedule,
        (SELECT string_agg(x."name", '|' ORDER BY x."name") FROM (
           SELECT b."name" FROM "barber_barbers" b
           WHERE b."barbershopId" IN (${ids}) AND b."isActive" = TRUE
             AND NOT EXISTS (SELECT 1 FROM "barber_schedules" sc WHERE sc."barberId" = b."id" AND sc."isActive" = TRUE)
           ORDER BY b."name" LIMIT 3) x
        ) AS barbers_no_schedule_names,
        (SELECT COUNT(*)::int FROM "barber_products" p
           WHERE p."barbershopId" IN (${ids}) AND p."isActive" = TRUE
             AND p."minStock" IS NOT NULL AND p."stock" <= p."minStock"
        ) AS low_stock,
        (SELECT string_agg(x."name", '|' ORDER BY x."stock", x."name") FROM (
           SELECT p."name", p."stock" FROM "barber_products" p
           WHERE p."barbershopId" IN (${ids}) AND p."isActive" = TRUE
             AND p."minStock" IS NOT NULL AND p."stock" <= p."minStock"
           ORDER BY p."stock", p."name" LIMIT 3) x
        ) AS low_stock_names,
        (SELECT COUNT(*)::int FROM "barber_client_memberships" m
           WHERE m."barbershopId" IN (${ids}) AND m."status" = 'ACTIVE'
             AND m."endAt" > ${utcTs(now)} AND m."endAt" <= ${utcTs(weekAhead)}
        ) AS memberships_soon,
        (SELECT COUNT(*)::int FROM "barber_appointments" a
           WHERE a."barbershopId" IN (${ids}) AND a."status" = 'PENDING'
             AND a."startAt" >= ${utcTs(tomorrowStart)} AND a."startAt" < ${utcTs(dayAfterStart)}
             ${barberFilter('a."barberId"', barberIds)}
        ) AS tomorrow_pending,
        (SELECT COUNT(*)::int FROM "barber_appointments" a
           WHERE a."barbershopId" IN (${ids}) AND a."status" IN ('PENDING', 'CONFIRMED')
             AND a."startAt" >= ${utcTs(tomorrowStart)} AND a."startAt" < ${utcTs(dayAfterStart)}
             ${barberFilter('a."barberId"', barberIds)}
        ) AS tomorrow_total,
        (SELECT COUNT(*)::int FROM "barber_appointments" a
           WHERE a."barbershopId" IN (${ids}) AND a."source" = 'PUBLIC' AND a."status" = 'PENDING'
             AND a."startAt" >= ${utcTs(now)}
        ) AS public_requests,
        EXISTS (SELECT 1 FROM "barber_barbers" b WHERE b."barbershopId" IN (${ids}) AND b."isActive" = TRUE) AS has_barbers,
        EXISTS (SELECT 1 FROM "barber_schedules" sc WHERE sc."barbershopId" IN (${ids}) AND sc."isActive" = TRUE) AS has_schedules,
        EXISTS (SELECT 1 FROM "barber_services" sv WHERE sv."barbershopId" IN (${ids}) AND sv."isActive" = TRUE) AS has_services,
        EXISTS (SELECT 1 FROM "barber_appointments" a WHERE a."barbershopId" IN (${ids})) AS has_appointments,
        EXISTS (SELECT 1 FROM "barber_sales" s WHERE s."barbershopId" IN (${ids})) AS has_sales,
        EXISTS (SELECT 1 FROM "barber_landing_configs" l WHERE l."barbershopId" IN (${ids}) AND l."publishedAt" IS NOT NULL) AS has_web
    `,
    // Turno abierto + sus totales (tickets vivos, vendido, propinas y
    // efectivo) en UNA sentencia. Mismo agregado que summarizeSession
    // (cash.ts): el efectivo esperado sale de expectedCashFor, abajo.
    canCash
      ? prisma.$queryRaw<OpenSessionRow[]>`
          SELECT cs."id", cs."openedAt", cs."openingAmount",
                 TRIM(u."firstName" || ' ' || u."lastName") AS opened_by,
                 COALESCE(sa.tickets, 0)::int AS tickets,
                 COALESCE(sa.sales_total, 0) AS sales_total,
                 COALESCE(sa.tips_total, 0) AS tips_total,
                 COALESCE(sa.cash_total, 0) AS cash_total
          FROM "barber_cash_sessions" cs
          JOIN "barber_users" u ON u."id" = cs."openedByUserId"
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS tickets,
                   SUM(s."subtotal") AS sales_total,
                   SUM(s."tip") AS tips_total,
                   SUM(CASE WHEN s."paymentMethod" = 'CASH' THEN s."total" ELSE 0 END) AS cash_total
            FROM "barber_sales" s
            WHERE s."cashSessionId" = cs."id" AND s."barbershopId" = cs."barbershopId" AND ${liveSale("s")}
          ) sa ON TRUE
          WHERE cs."barbershopId" = ${cashShopId} AND cs."closedAt" IS NULL
          ORDER BY cs."openedAt" DESC
          LIMIT 1
        `
      : Promise.resolve([] as OpenSessionRow[]),
  ]);
  const openSession = openSessionRows[0] ?? null;

  const byDay = new Map(dayRows.map((r) => [r.day, r]));
  const today = dayMoneyOf(byDay.get(todayKey));
  const yesterday = dayMoneyOf(byDay.get(yesterdayKey));
  const lastWeek = dayMoneyOf(byDay.get(weekAgoKey));
  const avgTicket = today.tickets > 0 ? toNum(today.revenueDec.div(today.tickets)) : null;

  // Visitas de hoy: conteos (no dinero) sobre las filas del día.
  let visits: InicioSummary["visits"] = null;
  const upcoming: InicioUpcoming[] = [];
  if (canAgenda) {
    const v = { total: 0, done: 0, pending: 0, inProgress: 0, cancelled: 0, noShow: 0, toCharge: 0 };
    const nowMs = now.getTime();
    const candidates: TodayAppointmentRow[] = [];
    for (const a of todayAppointments) {
      v.total += 1;
      switch (a.status as BarberAppointmentStatus) {
        case "DONE":
          v.done += 1;
          if (!a.charged) v.toCharge += 1;
          break;
        case "IN_PROGRESS":
          v.inProgress += 1;
          candidates.push(a);
          break;
        case "PENDING":
        case "CONFIRMED":
          v.pending += 1;
          if (new Date(a.endAt).getTime() >= nowMs) candidates.push(a);
          break;
        case "CANCELLED":
          v.cancelled += 1;
          break;
        case "NO_SHOW":
          v.noShow += 1;
          break;
      }
    }
    visits = v;
    for (const a of candidates.slice(0, 3)) {
      upcoming.push({
        id: a.id,
        startAt: new Date(a.startAt).toISOString(),
        endAt: new Date(a.endAt).toISOString(),
        status: a.status as BarberAppointmentStatus,
        clientName: a.client_name ?? null,
        barberName: a.barber_name ?? null,
        services: a.services ?? "",
      });
    }
  }

  let queue: InicioSummary["queue"] = null;
  if (canQueue) {
    const q = { waiting: 0, called: 0 };
    for (const g of queueGroups) {
      if (g.status === "WAITING") q.waiting = g._count._all;
      if (g.status === "CALLED") q.called = g._count._all;
    }
    queue = q;
  }

  const ar = alertsRows[0];
  const alerts: InicioAlerts = {
    barbersNoSchedule: canSchedule
      ? { count: intOf(ar?.barbers_no_schedule), names: splitNames(ar?.barbers_no_schedule_names ?? null) }
      : null,
    lowStock: canProducts
      ? { count: intOf(ar?.low_stock), names: splitNames(ar?.low_stock_names ?? null) }
      : null,
    membershipsSoon: canMemberships ? intOf(ar?.memberships_soon) : null,
    tomorrowPending: canAgenda ? intOf(ar?.tomorrow_pending) : null,
    tomorrowTotal: canAgenda ? intOf(ar?.tomorrow_total) : null,
    publicRequests: canRequests ? intOf(ar?.public_requests) : null,
  };

  const setup: InicioSetup = {
    hasBarbers: Boolean(ar?.has_barbers),
    hasSchedules: Boolean(ar?.has_schedules),
    hasServices: Boolean(ar?.has_services),
    hasAppointments: Boolean(ar?.has_appointments),
    hasSales: Boolean(ar?.has_sales),
    hasWeb: Boolean(ar?.has_web),
    isFresh: !ar?.has_appointments && !ar?.has_sales,
  };

  const cash: InicioCash | null = canCash
    ? openSession
      ? {
          open: true,
          sessionId: openSession.id,
          openedAt: new Date(openSession.openedAt).toISOString(),
          openedByName: openSession.opened_by || "—",
          // MISMA regla que la caja: fondo + Σ total de tickets vivos en efectivo.
          expectedCash: toNum(expectedCashFor(D(openSession.openingAmount as never), D(openSession.cash_total as never))),
          openingAmount: toNum(D(openSession.openingAmount as never)),
          ticketCount: intOf(openSession.tickets),
          salesTotal: toNum(D(openSession.sales_total as never)),
          tipsTotal: toNum(D(openSession.tips_total as never)),
        }
      : {
          open: false,
          sessionId: null,
          openedAt: null,
          openedByName: null,
          expectedCash: null,
          openingAmount: null,
          ticketCount: 0,
          salesTotal: 0,
          tipsTotal: 0,
        }
    : null;

  return {
    generatedAt: now.toISOString(),
    timezone: tz,
    date: todayKey,
    scope: {
      branchIds,
      activeBranchId: scope.activeBranchId,
      consolidated: scope.consolidated,
      canConsolidate: scope.canConsolidate,
      selfOnly,
      barberLinked: !selfOnly || Boolean(ctx.barber),
    },
    can: {
      agenda: canAgenda,
      cash: canCash,
      cashManage: can(ctx, "cash.manage"),
      queue: canQueue,
      reports: canReports,
      schedule: canSchedule,
      products: canProducts,
      memberships: canMemberships,
      requests: canRequests,
    },
    today: { tickets: today.tickets, revenue: today.revenue, tips: today.tips, total: today.total, avgTicket },
    compare: {
      yesterday: { tickets: yesterday.tickets, revenue: yesterday.revenue, tips: yesterday.tips, total: yesterday.total },
      lastWeek: { tickets: lastWeek.tickets, revenue: lastWeek.revenue, tips: lastWeek.tips, total: lastWeek.total },
      vsYesterdayPct: pctChange(today.revenueDec, yesterday.revenueDec),
      vsLastWeekPct: pctChange(today.revenueDec, lastWeek.revenueDec),
    },
    visits,
    upcoming,
    cash,
    queue,
    alerts,
    setup,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// B. REPORTES — feature `analytics` (Profesional). El gate de plan lo
// aplican la página y la ruta con gating.ts (assertBarberFeature); aquí se
// aplican permiso y alcance.
// ═══════════════════════════════════════════════════════════════════════

export type ReportRangeKey = "today" | "week" | "month" | "custom";

export interface ReportPeriod {
  key: ReportRangeKey;
  /** Primer y último día locales, inclusive (YYYY-MM-DD). */
  from: string;
  to: string;
  /** Instantes UTC [start, end). */
  start: string;
  end: string;
  days: number;
  /** Periodo anterior de la misma longitud (para la comparativa). */
  prevFrom: string;
  prevTo: string;
}

export const REPORT_MAX_DAYS = 366;

/** Ventana de "volvió dentro de X días" de la retención. */
export const REPORT_RETURN_WINDOW_DAYS = 30;

export function resolveReportPeriod(
  input: { range?: string | null; from?: string | null; to?: string | null },
  tz: string,
  now: Date = new Date(),
): ReportPeriod {
  const p = zonedParts(now, tz);
  const today: Ymd = { y: p.y, m: p.m, d: p.d };
  const todayDays = ymdToUtcDays(today);

  let key: ReportRangeKey = "month";
  let fromYmd: Ymd = { y: p.y, m: p.m, d: 1 };
  let toYmd: Ymd = today;

  const range = typeof input.range === "string" ? input.range : "";
  if (range === "today") {
    key = "today";
    fromYmd = today;
  } else if (range === "week") {
    key = "week";
    // Semana calendario: del lunes a hoy (domingo = 0 → 6 días atrás).
    const wd = weekdayOf(today);
    const back = wd === 0 ? 6 : wd - 1;
    fromYmd = ymdFromUtcDays(todayDays - back);
  } else if (range === "custom") {
    const f = parseDateKey(input.from);
    const t = parseDateKey(input.to);
    if (f && t) {
      key = "custom";
      let fd = ymdToUtcDays(f);
      let td = ymdToUtcDays(t);
      if (td < fd) [fd, td] = [td, fd];
      if (td - fd + 1 > REPORT_MAX_DAYS) fd = td - (REPORT_MAX_DAYS - 1);
      fromYmd = ymdFromUtcDays(fd);
      toYmd = ymdFromUtcDays(td);
    }
  }

  const fromDays = ymdToUtcDays(fromYmd);
  const toDays = ymdToUtcDays(toYmd);
  const days = toDays - fromDays + 1;
  const endYmd = ymdFromUtcDays(toDays + 1);
  const prevTo = ymdFromUtcDays(fromDays - 1);
  const prevFrom = ymdFromUtcDays(fromDays - days);

  return {
    key,
    from: ymdKey(fromYmd),
    to: ymdKey(toYmd),
    start: zonedMidnightUtc(fromYmd.y, fromYmd.m, fromYmd.d, tz).toISOString(),
    end: zonedMidnightUtc(endYmd.y, endYmd.m, endYmd.d, tz).toISOString(),
    days,
    prevFrom: ymdKey(prevFrom),
    prevTo: ymdKey(prevTo),
  };
}

export interface ReportDayRow {
  day: string;
  tickets: number;
  /** Servicios NETOS de descuentos (misma base que la comisión: servicios + ajustes). */
  services: number;
  products: number;
  tips: number;
  /** Descuentos aplicados (positivo). */
  discounts: number;
  /** Σ subtotal (sin propina). */
  revenue: number;
  /** Σ total (con propina). */
  total: number;
}

export interface ReportBarberRow {
  barberId: string;
  name: string;
  nickname: string | null;
  isActive: boolean;
  commissionType: BarberCommissionType;
  tickets: number;
  produced: number;
  tips: number;
  avgTicket: number | null;
  /** null = sin permiso commissions.view (la columna no viaja). */
  commission: number | null;
}

export interface ReportItemRow {
  id: string;
  kind: "service" | "product";
  name: string;
  qty: number;
  revenue: number;
  /** Solo productos con costo: revenue − qty × costo actual. */
  cost: number | null;
  margin: number | null;
  marginPct: number | null;
  /** % del ingreso de su tipo (servicios o productos). */
  share: number | null;
}

export interface ReportHeatCell {
  /** 0 = domingo (criterio JS y BarberSchedule.dayOfWeek). */
  dow: number;
  hour: number;
  visits: number;
}

export interface ReportOccupancy {
  cells: ReportHeatCell[];
  /** Horas [hourFrom, hourTo) que pinta la rejilla (del horario cargado). */
  hourFrom: number;
  hourTo: number;
  /** Por día de la semana: rango de horas abiertas según BarberSchedule (null = cerrado). */
  openHours: Array<{ dow: number; from: number; to: number } | null>;
  maxVisits: number;
  totalVisits: number;
  /** Celdas abiertas (según horario) sin una sola visita en el periodo. */
  deadSlots: Array<{ dow: number; hour: number }>;
  openSlots: number;
  peak: ReportHeatCell[];
}

export interface ReportNoShowRow {
  key: string;
  name: string | null;
  phone: string | null;
  count: number;
  lastAt: string | null;
}

export interface ReportNoShows {
  count: number;
  done: number;
  cancelled: number;
  /** no-shows / (no-shows + terminadas), en %. */
  rate: number | null;
  /** Quiénes reinciden: 2+ en el periodo. */
  repeat: ReportNoShowRow[];
}

export interface ReportRetention {
  newClients: number;
  returningClients: number;
  newReturned: number;
  windowDays: number;
  /** newReturned / newClients, en %. */
  returnRate: number | null;
}

export interface ReportPayment {
  method: BarberPaymentMethod;
  count: number;
  revenue: number;
  tips: number;
  total: number;
  /** % del total cobrado. */
  share: number | null;
}

export interface ReportsSummary {
  generatedAt: string;
  timezone: string;
  period: ReportPeriod;
  scope: InicioSummary["scope"];
  can: { commissions: boolean; products: boolean };
  totals: {
    tickets: number;
    services: number;
    products: number;
    tips: number;
    discounts: number;
    revenue: number;
    total: number;
    avgTicket: number | null;
    prevRevenue: number;
    vsPrevPct: number | null;
  };
  byDay: ReportDayRow[];
  byBarber: ReportBarberRow[];
  topServices: ReportItemRow[];
  topProducts: ReportItemRow[];
  occupancy: ReportOccupancy;
  noShows: ReportNoShows;
  retention: ReportRetention;
  payments: ReportPayment[];
}

export interface ReportsOptions extends StatsScopeInput {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  features?: Record<string, boolean>;
  now?: Date;
}

interface ReportDaySql {
  day: string;
  tickets: unknown;
  services: unknown;
  products: unknown;
  adjustments: unknown;
  tips: unknown;
  revenue: unknown;
  total: unknown;
}

interface ReportBarberSql {
  id: string;
  name: string;
  nickname: string | null;
  isActive: boolean;
  commissionType: string;
  tickets: unknown;
  produced: unknown;
  tips: unknown;
  commission: unknown;
}

interface ReportItemSql {
  serviceId: string | null;
  productId: string | null;
  name: string | null;
  qty: unknown;
  revenue: unknown;
  cost: unknown;
}

interface ReportHeatSql {
  dow: unknown;
  hour: unknown;
  visits: unknown;
}

interface ReportNoShowSql {
  key: string;
  name: string | null;
  phone: string | null;
  no_shows: unknown;
  last_at: Date | null;
}

interface ReportRetentionSql {
  new_clients: unknown;
  returning_clients: unknown;
  new_returned: unknown;
}

/**
 * Reportes del periodo. Lecturas a la base: lote 1 de 6 (ingresos por día, por
 * barbero, servicios+productos, ocupación, no-shows, estados) + lote 2 de 4
 * (retención, métodos de pago, periodo anterior, horario). Nada por fila.
 */
export async function getReportsSummary(ctx: BarberContext, opts: ReportsOptions = {}): Promise<ReportsSummary> {
  assertReportsAccess(ctx);
  const now = opts.now ?? new Date();
  const tz = tzOf(ctx);
  const features = opts.features ?? (await resolveBarberFeatures(ctx));
  const scope = await resolveStatsScope(ctx, opts);
  const { branchIds, barberIds, selfOnly } = scope;
  const period = resolveReportPeriod(opts, tz, now);
  const start = new Date(period.start);
  const end = new Date(period.end);
  const prevStart = (() => {
    const v = parseDateKey(period.prevFrom)!;
    return zonedMidnightUtc(v.y, v.m, v.d, tz);
  })();

  const includeCommission = can(ctx, "commissions.view");
  const includeProducts = features.products === true;
  const ids = Prisma.join(branchIds);
  const rangeSql = (col: string) =>
    Prisma.sql`${Prisma.raw(col)} >= ${utcTs(start)} AND ${Prisma.raw(col)} < ${utcTs(end)}`;

  const [dayRows, barberRows, itemRows, heatRows, noShowRows, statusGroups] = await Promise.all([
    prisma.$queryRaw<ReportDaySql[]>`
      SELECT to_char(${localTs(tz, 's."createdAt"')}, 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS tickets,
             COALESCE(SUM(i.services), 0) AS services,
             COALESCE(SUM(i.products), 0) AS products,
             COALESCE(SUM(i.adjustments), 0) AS adjustments,
             COALESCE(SUM(s."tip"), 0) AS tips,
             COALESCE(SUM(s."subtotal"), 0) AS revenue,
             COALESCE(SUM(s."total"), 0) AS total
      FROM "barber_sales" s
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(CASE WHEN it."serviceId" IS NOT NULL THEN it."qty" * it."unitPrice" END), 0) AS services,
               COALESCE(SUM(CASE WHEN it."productId" IS NOT NULL THEN it."qty" * it."unitPrice" END), 0) AS products,
               COALESCE(SUM(CASE WHEN it."serviceId" IS NULL AND it."productId" IS NULL THEN it."qty" * it."unitPrice" END), 0) AS adjustments
        FROM "barber_sale_items" it WHERE it."saleId" = s."id"
      ) i ON TRUE
      WHERE s."barbershopId" IN (${ids}) AND ${rangeSql('s."createdAt"')} AND ${liveSale("s")}
        ${barberFilter('s."barberId"', barberIds)}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<ReportBarberSql[]>`
      SELECT b."id", b."name", b."nickname", b."isActive", b."commissionType"::text AS "commissionType",
             COALESCE(sa.tickets, 0)::int AS tickets,
             COALESCE(sa.produced, 0) AS produced,
             COALESCE(sa.tips, 0) AS tips,
             COALESCE(ce.amount, 0) AS commission
      FROM "barber_barbers" b
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS tickets, SUM(s."subtotal") AS produced, SUM(s."tip") AS tips
        FROM "barber_sales" s
        WHERE s."barberId" = b."id" AND s."barbershopId" IN (${ids}) AND ${rangeSql('s."createdAt"')} AND ${liveSale("s")}
      ) sa ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(e."amount") AS amount
        FROM "barber_commission_entries" e
        WHERE e."barberId" = b."id" AND e."barbershopId" IN (${ids}) AND ${rangeSql('e."createdAt"')}
      ) ce ON TRUE
      WHERE b."barbershopId" IN (${ids}) ${barberFilter('b."id"', barberIds)}
      ORDER BY COALESCE(sa.produced, 0) DESC, b."name" ASC
    `,
    prisma.$queryRaw<ReportItemSql[]>`
      SELECT it."serviceId", it."productId", COALESCE(sv."name", pr."name") AS name,
             SUM(it."qty")::int AS qty,
             COALESCE(SUM(it."qty" * it."unitPrice"), 0) AS revenue,
             CASE WHEN it."productId" IS NOT NULL AND pr."cost" IS NOT NULL THEN SUM(it."qty" * pr."cost") END AS cost
      FROM "barber_sale_items" it
      JOIN "barber_sales" s ON s."id" = it."saleId"
      LEFT JOIN "barber_services" sv ON sv."id" = it."serviceId"
      LEFT JOIN "barber_products" pr ON pr."id" = it."productId"
      WHERE s."barbershopId" IN (${ids}) AND ${rangeSql('s."createdAt"')} AND ${liveSale("s")}
        AND (it."serviceId" IS NOT NULL OR it."productId" IS NOT NULL)
        ${barberFilter('s."barberId"', barberIds)}
      GROUP BY it."serviceId", it."productId", sv."name", pr."name", pr."cost"
      ORDER BY revenue DESC, qty DESC
      LIMIT 60
    `,
    prisma.$queryRaw<ReportHeatSql[]>`
      SELECT v.dow, v.hour, COUNT(*)::int AS visits FROM (
        SELECT EXTRACT(DOW FROM ${localTs(tz, 'a."startAt"')})::int AS dow,
               EXTRACT(HOUR FROM ${localTs(tz, 'a."startAt"')})::int AS hour
        FROM "barber_appointments" a
        WHERE a."barbershopId" IN (${ids}) AND a."status" IN ('DONE', 'IN_PROGRESS') AND ${rangeSql('a."startAt"')}
          ${barberFilter('a."barberId"', barberIds)}
        UNION ALL
        SELECT EXTRACT(DOW FROM ${localTs(tz, 's."createdAt"')})::int AS dow,
               EXTRACT(HOUR FROM ${localTs(tz, 's."createdAt"')})::int AS hour
        FROM "barber_sales" s
        WHERE s."barbershopId" IN (${ids}) AND s."appointmentId" IS NULL AND ${rangeSql('s."createdAt"')} AND ${liveSale("s")}
          AND EXISTS (SELECT 1 FROM "barber_sale_items" it WHERE it."saleId" = s."id" AND it."serviceId" IS NOT NULL)
          ${barberFilter('s."barberId"', barberIds)}
      ) v
      GROUP BY v.dow, v.hour
    `,
    prisma.$queryRaw<ReportNoShowSql[]>`
      SELECT x.key, MAX(x.name) AS name, MAX(x.phone) AS phone, COUNT(*)::int AS no_shows, MAX(x.at) AS last_at FROM (
        SELECT COALESCE(a."clientId",
                        NULLIF('p:' || COALESCE(a."clientPhone", ''), 'p:'),
                        NULLIF('n:' || COALESCE(a."clientName", ''), 'n:'),
                        a."id") AS key,
               COALESCE(c."name", a."clientName") AS name,
               COALESCE(c."phone", a."clientPhone") AS phone,
               a."startAt" AS at
        FROM "barber_appointments" a
        LEFT JOIN "barber_clients" c ON c."id" = a."clientId"
        WHERE a."barbershopId" IN (${ids}) AND a."status" = 'NO_SHOW' AND ${rangeSql('a."startAt"')}
          ${barberFilter('a."barberId"', barberIds)}
      ) x
      GROUP BY x.key
      ORDER BY no_shows DESC, last_at DESC
      LIMIT 10
    `,
    prisma.barberAppointment.groupBy({
      by: ["status"],
      where: {
        barbershopId: { in: branchIds },
        startAt: { gte: start, lt: end },
        ...barberWhere(barberIds),
      },
      _count: { _all: true },
    }),
  ]);

  const [retentionRows, paymentGroups, prevAgg, scheduleGroups] = await Promise.all([
    prisma.$queryRaw<ReportRetentionSql[]>`
      WITH visits AS (
        SELECT a."clientId" AS client_id, a."startAt" AS at
        FROM "barber_appointments" a
        WHERE a."barbershopId" IN (${ids}) AND a."status" = 'DONE' AND a."clientId" IS NOT NULL
          ${barberFilter('a."barberId"', barberIds)}
        UNION ALL
        SELECT s."clientId" AS client_id, s."createdAt" AS at
        FROM "barber_sales" s
        WHERE s."barbershopId" IN (${ids}) AND s."appointmentId" IS NULL AND s."clientId" IS NOT NULL AND ${liveSale("s")}
          AND EXISTS (SELECT 1 FROM "barber_sale_items" it WHERE it."saleId" = s."id" AND it."serviceId" IS NOT NULL)
          ${barberFilter('s."barberId"', barberIds)}
      ), per_client AS (
        SELECT client_id, MIN(at) AS first_at,
               bool_or(at >= ${utcTs(start)} AND at < ${utcTs(end)}) AS in_period
        FROM visits GROUP BY client_id
      ), new_clients AS (
        SELECT p.client_id, p.first_at,
               EXISTS (SELECT 1 FROM visits v
                       WHERE v.client_id = p.client_id AND v.at > p.first_at
                         AND v.at <= p.first_at + make_interval(days => ${REPORT_RETURN_WINDOW_DAYS}::int)) AS returned
        FROM per_client p
        WHERE p.first_at >= ${utcTs(start)} AND p.first_at < ${utcTs(end)}
      )
      SELECT (SELECT COUNT(*)::int FROM new_clients) AS new_clients,
             (SELECT COUNT(*)::int FROM per_client WHERE in_period AND first_at < ${utcTs(start)}) AS returning_clients,
             (SELECT COUNT(*)::int FROM new_clients WHERE returned) AS new_returned
    `,
    prisma.barberSale.groupBy({
      by: ["paymentMethod"],
      where: {
        barbershopId: { in: branchIds },
        createdAt: { gte: start, lt: end },
        ...barberWhere(barberIds),
        ...NOT_CANCELLED,
      },
      _count: { _all: true },
      _sum: { subtotal: true, tip: true, total: true },
    }),
    prisma.barberSale.aggregate({
      where: {
        barbershopId: { in: branchIds },
        createdAt: { gte: prevStart, lt: start },
        ...barberWhere(barberIds),
      },
      _sum: { subtotal: true },
    }),
    prisma.barberSchedule.groupBy({
      by: ["dayOfWeek"],
      where: { barbershopId: { in: branchIds }, isActive: true, ...barberWhere(barberIds) },
      _min: { startMinute: true },
      _max: { endMinute: true },
    }),
  ]);

  // ── Ingresos por día ──
  const byDayMap = new Map(dayRows.map((r) => [r.day, r]));
  const fromYmd = parseDateKey(period.from)!;
  const fromDays = ymdToUtcDays(fromYmd);
  const byDay: ReportDayRow[] = [];
  const tot = { tickets: 0, services: ZERO, products: ZERO, tips: ZERO, discounts: ZERO, revenue: ZERO, total: ZERO };
  for (let i = 0; i < period.days; i++) {
    const key = ymdKey(ymdFromUtcDays(fromDays + i));
    const r = byDayMap.get(key);
    const services = D(r?.services as never);
    const adjustments = D(r?.adjustments as never); // negativo (descuentos)
    const products = D(r?.products as never);
    const tips = D(r?.tips as never);
    const revenue = D(r?.revenue as never);
    const total = D(r?.total as never);
    const netServices = services.plus(adjustments);
    const discounts = adjustments.isNegative() ? adjustments.negated() : ZERO;
    tot.tickets += intOf(r?.tickets);
    tot.services = tot.services.plus(netServices);
    tot.products = tot.products.plus(products);
    tot.tips = tot.tips.plus(tips);
    tot.discounts = tot.discounts.plus(discounts);
    tot.revenue = tot.revenue.plus(revenue);
    tot.total = tot.total.plus(total);
    byDay.push({
      day: key,
      tickets: intOf(r?.tickets),
      services: toNum(netServices),
      products: toNum(products),
      tips: toNum(tips),
      discounts: toNum(discounts),
      revenue: toNum(revenue),
      total: toNum(total),
    });
  }
  const prevRevenue = money(D(prevAgg._sum.subtotal));

  // ── Por barbero ──
  const byBarber: ReportBarberRow[] = barberRows
    .map((b) => {
      const tickets = intOf(b.tickets);
      const produced = money(D(b.produced as never));
      return {
        barberId: b.id,
        name: b.name,
        nickname: b.nickname,
        isActive: b.isActive,
        commissionType: b.commissionType as BarberCommissionType,
        tickets,
        produced: produced.toNumber(),
        tips: toNum(D(b.tips as never)),
        avgTicket: tickets > 0 ? toNum(produced.div(tickets)) : null,
        commission: includeCommission ? toNum(D(b.commission as never)) : null,
      };
    })
    .filter((b) => b.isActive || b.tickets > 0);

  // ── Servicios y productos más vendidos ──
  const services: ReportItemRow[] = [];
  const products: ReportItemRow[] = [];
  let servicesRevenue = ZERO;
  let productsRevenue = ZERO;
  for (const it of itemRows) {
    const revenue = D(it.revenue as never);
    if (it.productId) productsRevenue = productsRevenue.plus(revenue);
    else servicesRevenue = servicesRevenue.plus(revenue);
  }
  for (const it of itemRows) {
    const revenue = money(D(it.revenue as never));
    const kind: "service" | "product" = it.productId ? "product" : "service";
    const base = kind === "product" ? productsRevenue : servicesRevenue;
    const cost = kind === "product" && it.cost !== null && it.cost !== undefined ? money(D(it.cost as never)) : null;
    const margin = cost === null ? null : money(revenue.minus(cost));
    const row: ReportItemRow = {
      id: (it.productId ?? it.serviceId) as string,
      kind,
      name: it.name ?? "—",
      qty: intOf(it.qty),
      revenue: revenue.toNumber(),
      cost: cost === null ? null : cost.toNumber(),
      margin: margin === null ? null : margin.toNumber(),
      marginPct: margin === null || revenue.isZero() ? null : margin.div(revenue).times(100).toDecimalPlaces(1).toNumber(),
      share: base.isZero() ? null : revenue.div(base).times(100).toDecimalPlaces(1).toNumber(),
    };
    if (kind === "product") {
      if (includeProducts) products.push(row);
    } else services.push(row);
  }

  // ── Ocupación por hora × día ──
  const openHours: ReportOccupancy["openHours"] = [null, null, null, null, null, null, null];
  for (const g of scheduleGroups) {
    const from = Math.floor((g._min.startMinute ?? BARBER_DEFAULT_DAY_START_MIN) / 60);
    const to = Math.ceil((g._max.endMinute ?? BARBER_DEFAULT_DAY_END_MIN) / 60);
    if (g.dayOfWeek >= 0 && g.dayOfWeek <= 6 && to > from) openHours[g.dayOfWeek] = { dow: g.dayOfWeek, from, to };
  }
  const hasSchedule = openHours.some((h) => h !== null);
  if (!hasSchedule) {
    for (let d = 0; d < 7; d++) {
      openHours[d] = { dow: d, from: Math.floor(BARBER_DEFAULT_DAY_START_MIN / 60), to: Math.ceil(BARBER_DEFAULT_DAY_END_MIN / 60) };
    }
  }
  const cellMap = new Map<string, number>();
  let maxVisits = 0;
  let totalVisits = 0;
  let minHour = 24;
  let maxHour = 0;
  for (const r of heatRows) {
    const dow = intOf(r.dow);
    const hour = intOf(r.hour);
    const visits = intOf(r.visits);
    cellMap.set(`${dow}:${hour}`, visits);
    totalVisits += visits;
    if (visits > maxVisits) maxVisits = visits;
    if (visits > 0) {
      if (hour < minHour) minHour = hour;
      if (hour + 1 > maxHour) maxHour = hour + 1;
    }
  }
  let hourFrom = 24;
  let hourTo = 0;
  for (const h of openHours) {
    if (!h) continue;
    if (h.from < hourFrom) hourFrom = h.from;
    if (h.to > hourTo) hourTo = h.to;
  }
  if (minHour < hourFrom) hourFrom = minHour;
  if (maxHour > hourTo) hourTo = maxHour;
  if (hourTo <= hourFrom) {
    hourFrom = Math.floor(BARBER_DEFAULT_DAY_START_MIN / 60);
    hourTo = Math.ceil(BARBER_DEFAULT_DAY_END_MIN / 60);
  }
  const cells: ReportHeatCell[] = [];
  const deadSlots: Array<{ dow: number; hour: number }> = [];
  let openSlots = 0;
  // Solo los días de la semana que caen dentro del periodo cuentan como
  // "abiertos": con "hoy" no hay horas muertas en los otros seis días.
  const dowsInPeriod = new Set<number>();
  for (let i = 0; i < Math.min(period.days, 7); i++) dowsInPeriod.add(weekdayOf(ymdFromUtcDays(fromDays + i)));
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = hourFrom; hour < hourTo; hour++) {
      const visits = cellMap.get(`${dow}:${hour}`) ?? 0;
      cells.push({ dow, hour, visits });
      const open = openHours[dow];
      if (open && dowsInPeriod.has(dow) && hour >= open.from && hour < open.to) {
        openSlots += 1;
        if (visits === 0) deadSlots.push({ dow, hour });
      }
    }
  }
  const peak = [...cells].filter((c) => c.visits > 0).sort((a, b) => b.visits - a.visits).slice(0, 3);

  // ── No-shows ──
  let done = 0;
  let noShowCount = 0;
  let cancelled = 0;
  for (const g of statusGroups) {
    if (g.status === "DONE") done += g._count._all;
    if (g.status === "NO_SHOW") noShowCount += g._count._all;
    if (g.status === "CANCELLED") cancelled += g._count._all;
  }
  const repeat: ReportNoShowRow[] = noShowRows
    .map((r) => ({
      key: r.key,
      name: r.name,
      phone: r.phone,
      count: intOf(r.no_shows),
      lastAt: r.last_at ? new Date(r.last_at).toISOString() : null,
    }))
    .filter((r) => r.count >= 2);

  // ── Retención ──
  const rt = retentionRows[0];
  const newClients = intOf(rt?.new_clients);
  const newReturned = intOf(rt?.new_returned);

  // ── Métodos de pago ──
  const paymentsTotal = paymentGroups.reduce<Money>((acc, g) => acc.plus(D(g._sum.total)), ZERO);
  const order: BarberPaymentMethod[] = ["CASH", "CARD", "SPEI", "STRIPE"];
  const payments: ReportPayment[] = order
    .map((method) => {
      const g = paymentGroups.find((x) => x.paymentMethod === method);
      const total = money(D(g?._sum.total));
      return {
        method,
        count: g?._count._all ?? 0,
        revenue: toNum(D(g?._sum.subtotal)),
        tips: toNum(D(g?._sum.tip)),
        total: total.toNumber(),
        share: paymentsTotal.isZero() ? null : total.div(paymentsTotal).times(100).toDecimalPlaces(1).toNumber(),
      };
    })
    .filter((p) => p.count > 0 || p.method !== "STRIPE");

  const revenue = money(tot.revenue);
  return {
    generatedAt: now.toISOString(),
    timezone: tz,
    period,
    scope: {
      branchIds,
      activeBranchId: scope.activeBranchId,
      consolidated: scope.consolidated,
      canConsolidate: scope.canConsolidate,
      selfOnly,
      barberLinked: !selfOnly || Boolean(ctx.barber),
    },
    can: { commissions: includeCommission, products: includeProducts },
    totals: {
      tickets: tot.tickets,
      services: toNum(tot.services),
      products: toNum(tot.products),
      tips: toNum(tot.tips),
      discounts: toNum(tot.discounts),
      revenue: revenue.toNumber(),
      total: toNum(tot.total),
      avgTicket: tot.tickets > 0 ? toNum(revenue.div(tot.tickets)) : null,
      prevRevenue: prevRevenue.toNumber(),
      vsPrevPct: pctChange(revenue, prevRevenue),
    },
    byDay,
    byBarber,
    topServices: services.slice(0, 15),
    topProducts: products.slice(0, 15),
    occupancy: { cells, hourFrom, hourTo, openHours, maxVisits, totalVisits, deadSlots, openSlots, peak },
    noShows: {
      count: noShowCount,
      done,
      cancelled,
      rate: ratioPct(noShowCount, noShowCount + done),
      repeat,
    },
    retention: {
      newClients,
      returningClients: intOf(rt?.returning_clients),
      newReturned,
      windowDays: REPORT_RETURN_WINDOW_DAYS,
      returnRate: ratioPct(newReturned, newClients),
    },
    payments,
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────

export interface ReportsCsvLabels {
  section: string;
  day: string;
  tickets: string;
  services: string;
  products: string;
  tips: string;
  discounts: string;
  revenue: string;
  total: string;
  barber: string;
  produced: string;
  avgTicket: string;
  commission: string;
  item: string;
  qty: string;
  cost: string;
  margin: string;
  marginPct: string;
  weekday: string;
  hour: string;
  visits: string;
  client: string;
  phone: string;
  noShows: string;
  lastAt: string;
  method: string;
  share: string;
  metric: string;
  value: string;
  sections: {
    summary: string;
    byDay: string;
    byBarber: string;
    services: string;
    products: string;
    occupancy: string;
    noShows: string;
    retention: string;
    payments: string;
  };
  weekdays: string[];
  methods: Record<string, string>;
  metrics: {
    period: string;
    tickets: string;
    revenue: string;
    tips: string;
    total: string;
    avgTicket: string;
    prevRevenue: string;
    noShowRate: string;
    newClients: string;
    returningClients: string;
    newReturned: string;
    returnRate: string;
  };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? String(v) : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * CSV plano (UTF-8 con BOM para Excel, CRLF) con todas las secciones del
 * reporte, una debajo de otra, cada una con su encabezado. Los números van
 * sin formato de moneda para que se puedan sumar en la hoja.
 */
export function buildReportsCsv(s: ReportsSummary, L: ReportsCsvLabels): string {
  const lines: string[] = [];
  const push = (cells: unknown[]) => lines.push(csvLine(cells));
  const blank = () => lines.push("");

  push([L.sections.summary]);
  push([L.metric, L.value]);
  push([L.metrics.period, `${s.period.from} → ${s.period.to}`]);
  push([L.metrics.tickets, s.totals.tickets]);
  push([L.metrics.revenue, s.totals.revenue]);
  push([L.metrics.tips, s.totals.tips]);
  push([L.metrics.total, s.totals.total]);
  push([L.metrics.avgTicket, s.totals.avgTicket ?? ""]);
  push([L.metrics.prevRevenue, s.totals.prevRevenue]);
  push([L.metrics.noShowRate, s.noShows.rate ?? ""]);
  blank();

  push([L.sections.byDay]);
  push([L.day, L.tickets, L.services, L.products, L.tips, L.discounts, L.revenue, L.total]);
  for (const d of s.byDay) push([d.day, d.tickets, d.services, d.products, d.tips, d.discounts, d.revenue, d.total]);
  blank();

  push([L.sections.byBarber]);
  const barberHead = [L.barber, L.tickets, L.produced, L.tips, L.avgTicket];
  if (s.can.commissions) barberHead.push(L.commission);
  push(barberHead);
  for (const b of s.byBarber) {
    const row: unknown[] = [b.nickname || b.name, b.tickets, b.produced, b.tips, b.avgTicket ?? ""];
    if (s.can.commissions) row.push(b.commission ?? "");
    push(row);
  }
  blank();

  push([L.sections.services]);
  push([L.item, L.qty, L.revenue, L.share]);
  for (const it of s.topServices) push([it.name, it.qty, it.revenue, it.share ?? ""]);
  blank();

  if (s.can.products) {
    push([L.sections.products]);
    push([L.item, L.qty, L.revenue, L.cost, L.margin, L.marginPct, L.share]);
    for (const it of s.topProducts) push([it.name, it.qty, it.revenue, it.cost ?? "", it.margin ?? "", it.marginPct ?? "", it.share ?? ""]);
    blank();
  }

  push([L.sections.occupancy]);
  push([L.weekday, L.hour, L.visits]);
  for (const c of s.occupancy.cells) push([L.weekdays[c.dow] ?? c.dow, `${pad2(c.hour)}:00`, c.visits]);
  blank();

  push([L.sections.noShows]);
  push([L.client, L.phone, L.noShows, L.lastAt]);
  for (const r of s.noShows.repeat) push([r.name ?? "", r.phone ?? "", r.count, r.lastAt ?? ""]);
  blank();

  push([L.sections.retention]);
  push([L.metric, L.value]);
  push([L.metrics.newClients, s.retention.newClients]);
  push([L.metrics.returningClients, s.retention.returningClients]);
  push([`${L.metrics.newReturned} (${s.retention.windowDays}d)`, s.retention.newReturned]);
  push([L.metrics.returnRate, s.retention.returnRate ?? ""]);
  blank();

  push([L.sections.payments]);
  push([L.method, L.tickets, L.revenue, L.tips, L.total, L.share]);
  for (const p of s.payments) push([L.methods[p.method] ?? p.method, p.count, p.revenue, p.tips, p.total, p.share ?? ""]);

  // BOM para que Excel abra el UTF-8 con acentos; CRLF por el mismo motivo.
  return String.fromCharCode(0xfeff) + lines.join("\r\n") + "\r\n";
}

// ── Errores → HTTP (lo que las rutas necesitan además de moneyErrorResponse) ──

export function isStatsScopeError(e: unknown): e is BarberCajaError {
  return e instanceof BarberCajaError && e.code === "FORBIDDEN_SCOPE";
}
