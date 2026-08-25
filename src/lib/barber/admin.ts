import "server-only";
import { Prisma } from "@prisma/client";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { getBarberPlans } from "@/lib/barber/plans";
import {
  BARBER_PLAN_IDS,
  isBarberPlanId,
  isBarbershopSubscriptionActive,
  type BarberPlanId,
  type BarberResolvedPlan,
} from "@/lib/barber/plan-shared";
import {
  BARBER_FILES_BUCKET,
  BARBER_TICKET_CATEGORIES,
  type BarberSupportAttachment,
  type BarberTicketAuthor,
  type BarberTicketPriority,
  type BarberTicketStatus,
} from "@/lib/barber/types";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — capa de datos de la sección /admin/barberias.
 *
 * Único módulo server del vertical que lee y escribe para el panel de
 * plataforma. Espejo funcional de lo que el dental resuelve en
 * `src/lib/admin/mrr.ts` + `src/lib/support/service.ts`, pero SIN tocar
 * ninguno de esos archivos ni sus tablas: aquí sólo se leen modelos
 * `Barber*` / `Barbershop`.
 *
 * REGLAS QUE ESTE ARCHIVO SOSTIENE
 *  1. NÚMEROS SEPARADOS. Ninguna query de este módulo toca `Clinic`,
 *     `SupportTicket` ni ningún modelo del dental. El MRR de barber sale
 *     exclusivamente de filas `barber_shops` × precios de
 *     `barber_plan_configs`; es imposible que arrastre una suscripción
 *     dental.
 *  2. DINERO EN DECIMAL. Los precios se leen como `Prisma.Decimal` desde
 *     `barber_plan_configs` y se suman con `Decimal.add`. Nunca hay un
 *     `+` de floats sobre dinero y NUNCA hay un precio escrito a mano; el
 *     fallback de `getBarberPlans()` (= el seed de sql/barber.sql) sólo
 *     entra si la tabla todavía no tiene la fila.
 *  3. LA MATRIZ ES LA CUENTA. La suscripción vive en la fila con
 *     `parentId = null` y el webhook la propaga a las sucursales
 *     (`applyBarberSubscription`). Por eso el MRR y el conteo de "cuentas"
 *     sólo miran matrices: contar sucursales cobraría dos veces.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Errores ─────────────────────────────────────────────────────────────

export class BarberAdminError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BarberAdminError";
    this.status = status;
  }
}

// ── Constantes ──────────────────────────────────────────────────────────

/** Valor que escribe una suspensión MANUAL desde el panel de plataforma.
 *  Deliberadamente distinto de cualquier estado que mande Stripe, para que
 *  la lista pueda decir "suspendida por DaleControl" y no confundirla con
 *  un `past_due`. `isBarbershopSubscriptionActive` lo deja fuera y
 *  `billingStatusKey` (panel de la barbería) lo trata como "unknown", que
 *  ya es una cara existente y ofrece pagar. */
export const BARBER_MANUAL_SUSPENDED_STATUS = "suspended";

/** Estado al que vuelve una reactivación manual. Stripe manda: el siguiente
 *  webhook de la suscripción reescribe este valor con el real. */
export const BARBER_MANUAL_REACTIVATED_STATUS = "active";

/** Tope de filas de la lista. Muy por encima del universo real del vertical;
 *  existe para que una tabla enorme no tumbe la página. */
const LIST_LIMIT = 500;
const TICKET_LIMIT = 300;
const THREAD_LIMIT = 500;

/** Nota mínima de una acción manual: obligar a escribir algo legible. */
export const BARBER_ADMIN_NOTE_MIN = 8;
export const BARBER_ADMIN_NOTE_MAX = 1000;

const ATTACHMENT_URL_TTL_SECONDS = 60 * 10;

/** Prefijo de los adjuntos de soporte dentro de `barber-files` (bucket PRIVADO). */
export const BARBER_SUPPORT_PREFIX = "barber-support";

// ── Utilidades ──────────────────────────────────────────────────────────

const ZERO = new Prisma.Decimal(0);

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** El más reciente de un puñado de fechas (ignora nulos). */
function latest(...dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!best || d.getTime() > best.getTime()) best = d;
  }
  return best;
}

function startOfMonth(ref: Date): Date {
  return new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
}

function startOfNextMonth(ref: Date): Date {
  return new Date(ref.getFullYear(), ref.getMonth() + 1, 1, 0, 0, 0, 0);
}

/** Estados que significan "esta cuenta ya no paga" (para las bajas del mes). */
const LAPSED_STATUSES = [
  "canceled",
  "cancelled",
  "unpaid",
  "incomplete_expired",
  BARBER_MANUAL_SUSPENDED_STATUS,
];

/**
 * Precios mensuales por plan en `Prisma.Decimal`.
 *
 * Se lee la tabla DIRECTO (no vía `getBarberPlans`) porque ese helper
 * normaliza `Decimal → number` para la UI y aquí el dinero no puede pasar
 * por float. Para cualquier plan que la tabla todavía no tenga se cae al
 * plan resuelto — que a su vez cae al seed. En ningún camino hay un número
 * escrito en este archivo.
 */
async function loadPlanPrices(): Promise<{
  prices: Record<BarberPlanId, Prisma.Decimal>;
  plans: BarberResolvedPlan[];
}> {
  const plans = await getBarberPlans();
  const prices = {} as Record<BarberPlanId, Prisma.Decimal>;
  for (const p of plans) prices[p.id] = new Prisma.Decimal(String(p.priceMonthly));

  try {
    const rows = await prisma.barberPlanConfig.findMany({
      select: { planId: true, priceMonthly: true },
    });
    for (const row of rows) {
      if (isBarberPlanId(row.planId)) prices[row.planId] = new Prisma.Decimal(row.priceMonthly);
    }
  } catch (e) {
    // Tabla aún sin migrar: se queda el precio del plan resuelto (= seed).
    console.warn("[barber/admin] barber_plan_configs no disponible:", e);
  }

  return { prices, plans };
}

function coercePlan(plan: string | null | undefined): BarberPlanId {
  return isBarberPlanId(plan) ? plan : "BASICO";
}

// ── A. Lista de barberías ───────────────────────────────────────────────

export interface AdminBarbershopRow {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  plan: BarberPlanId;
  planName: string;
  /** Precio de lista del plan, en pesos, como string decimal ("199.00"). */
  planPriceMonthly: string;
  subscriptionStatus: string;
  subscriptionActive: boolean;
  isActive: boolean;
  createdAt: string;
  /** true = sucursal (la suscripción la paga su matriz). */
  isBranch: boolean;
  branchName: string | null;
  parentName: string | null;
  /** Sedes hijas ACTIVAS (0 en una sucursal). */
  branchCount: number;
  barbers: number;
  teamUsers: number;
  whatsappConnected: boolean;
  whatsappMode: string;
  messagesUsedPeriod: number;
  /** -1 = ilimitado (viene del plan, nunca de código). */
  messageQuota: number;
  lastActivityAt: string | null;
  openTickets: number;
}

export interface AdminBarbershopFilters {
  /** Una sola fila (lo usa la ficha para reutilizar el mismo armado). */
  id?: string | null;
  /** BASICO | AVANZADO | PROFESIONAL */
  plan?: string | null;
  /** "active" | "inactive" | un subscriptionStatus exacto */
  status?: string | null;
  /** "all" (default) | "parents" | "branches" */
  scope?: string | null;
  q?: string | null;
}

/**
 * Roster del vertical. Una query por dimensión agregada (nunca N+1): las
 * cuentas de barberos, tickets abiertos y las tres marcas de tiempo que
 * componen "última actividad" salen de `groupBy`, no de un include por fila.
 */
export async function listBarbershopsForAdmin(
  filters: AdminBarbershopFilters = {},
): Promise<AdminBarbershopRow[]> {
  const where: Prisma.BarbershopWhereInput = {};

  if (filters.id) where.id = filters.id;
  if (filters.plan && isBarberPlanId(filters.plan)) where.plan = filters.plan;

  if (filters.status === "active") {
    where.subscriptionStatus = { in: ["active", "trialing", "paid"] };
  } else if (filters.status === "inactive") {
    where.subscriptionStatus = { notIn: ["active", "trialing", "paid"] };
  } else if (filters.status) {
    where.subscriptionStatus = filters.status;
  }

  if (filters.scope === "parents") where.parentId = null;
  else if (filters.scope === "branches") where.parentId = { not: null };

  const term = (filters.q ?? "").trim();
  if (term) {
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { slug: { contains: term, mode: "insensitive" } },
      { city: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
    ];
  }

  const shops = await prisma.barbershop.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      state: true,
      plan: true,
      subscriptionStatus: true,
      isActive: true,
      createdAt: true,
      parentId: true,
      branchName: true,
      whatsappSenderMode: true,
      phoneNumberId: true,
      whatsappVerifiedAt: true,
      messagesUsedPeriod: true,
      parent: { select: { name: true } },
      _count: { select: { users: true } },
    },
  });

  if (shops.length === 0) return [];

  const ids = shops.map((s) => s.id);
  const { plans } = await loadPlanPrices();
  const planById = new Map(plans.map((p) => [p.id, p]));

  const [barberCounts, ticketCounts, lastAppt, lastSale, lastLogin, branchCounts] =
    await Promise.all([
      prisma.barber.groupBy({
        by: ["barbershopId"],
        where: { barbershopId: { in: ids }, isActive: true },
        _count: { _all: true },
      }),
      prisma.barberSupportTicket.groupBy({
        by: ["barbershopId"],
        where: { barbershopId: { in: ids }, status: { not: "CLOSED" } },
        _count: { _all: true },
      }),
      prisma.barberAppointment.groupBy({
        by: ["barbershopId"],
        where: { barbershopId: { in: ids } },
        _max: { createdAt: true },
      }),
      prisma.barberSale.groupBy({
        by: ["barbershopId"],
        where: { barbershopId: { in: ids } },
        _max: { createdAt: true },
      }),
      prisma.barberUser.groupBy({
        by: ["barbershopId"],
        where: { barbershopId: { in: ids } },
        _max: { lastLogin: true },
      }),
      prisma.barbershop.groupBy({
        by: ["parentId"],
        where: { parentId: { in: ids }, isActive: true },
        _count: { _all: true },
      }),
    ]);

  const barbersBy = new Map(barberCounts.map((r) => [r.barbershopId, r._count._all]));
  const ticketsBy = new Map(ticketCounts.map((r) => [r.barbershopId, r._count._all]));
  const apptBy = new Map(lastAppt.map((r) => [r.barbershopId, r._max.createdAt]));
  const saleBy = new Map(lastSale.map((r) => [r.barbershopId, r._max.createdAt]));
  const loginBy = new Map(lastLogin.map((r) => [r.barbershopId, r._max.lastLogin]));
  const branchesBy = new Map(
    branchCounts.filter((r) => r.parentId).map((r) => [r.parentId as string, r._count._all]),
  );

  return shops.map((s) => {
    const planId = coercePlan(s.plan);
    const plan = planById.get(planId);
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      city: s.city,
      state: s.state,
      plan: planId,
      planName: plan?.name ?? planId,
      planPriceMonthly: new Prisma.Decimal(String(plan?.priceMonthly ?? 0)).toFixed(2),
      subscriptionStatus: s.subscriptionStatus,
      subscriptionActive: isBarbershopSubscriptionActive(s),
      isActive: s.isActive,
      createdAt: s.createdAt.toISOString(),
      isBranch: s.parentId !== null,
      branchName: s.branchName,
      parentName: s.parent?.name ?? null,
      branchCount: branchesBy.get(s.id) ?? 0,
      barbers: barbersBy.get(s.id) ?? 0,
      teamUsers: s._count.users,
      whatsappConnected: isWhatsappConnected(s),
      whatsappMode: s.whatsappSenderMode,
      messagesUsedPeriod: s.messagesUsedPeriod,
      messageQuota: plan?.messageQuota ?? 0,
      lastActivityAt: iso(
        latest(apptBy.get(s.id), saleBy.get(s.id), loginBy.get(s.id), s.createdAt),
      ),
      openTickets: ticketsBy.get(s.id) ?? 0,
    };
  });
}

/**
 * "WhatsApp conectado" con el mismo criterio en los dos modelos de envío:
 *  - OWN_WABA  → tiene phoneNumberId y quedó verificada.
 *  - PLATFORM  → sale por el número de DaleControl; siempre está conectada.
 */
function isWhatsappConnected(shop: {
  whatsappSenderMode: string;
  phoneNumberId: string | null;
  whatsappVerifiedAt: Date | null;
}): boolean {
  if (shop.whatsappSenderMode === "PLATFORM") return true;
  return Boolean(shop.phoneNumberId && shop.whatsappVerifiedAt);
}

// ── D. Métricas del vertical ────────────────────────────────────────────

export interface BarberPlanBreakdown {
  planId: BarberPlanId;
  name: string;
  /** Precio de lista, string decimal. */
  priceMonthly: string;
  accounts: number;
  activeAccounts: number;
  /** activeAccounts × priceMonthly, string decimal. */
  mrr: string;
}

export interface BarberVerticalMetrics {
  /** Matrices (parentId = null). Una sucursal NO es una cuenta. */
  accounts: number;
  activeAccounts: number;
  branches: number;
  /** Suma Decimal de los planes de las matrices con suscripción activa. */
  mrrMonthly: string;
  signupsThisMonth: number;
  /** Aproximado — ver `churnIsApproximate`. */
  churnThisMonth: number;
  churnIsApproximate: true;
  byPlan: BarberPlanBreakdown[];
  openTickets: number;
  /** Tickets abiertos cuyo último mensaje NO es de ADMIN. */
  ticketsPendingReply: number;
}

const EMPTY_METRICS: BarberVerticalMetrics = {
  accounts: 0,
  activeAccounts: 0,
  branches: 0,
  mrrMonthly: "0.00",
  signupsThisMonth: 0,
  churnThisMonth: 0,
  churnIsApproximate: true,
  byPlan: [],
  openTickets: 0,
  ticketsPendingReply: 0,
};

/**
 * Métricas del vertical barber. Nunca lanza: un fallo devuelve el bloque
 * vacío y la página se sigue pintando.
 *
 * `churnThisMonth` es APROXIMADO a propósito y así se etiqueta en la UI: sin
 * una tabla de historial de suscripción, lo único observable es "hoy está en
 * un estado que ya no paga y su fila se movió este mes". Un cambio de nombre
 * también mueve `updatedAt`, así que el número puede quedar alto; jamás se
 * presenta como exacto.
 */
export async function getBarberVerticalMetrics(now: Date = new Date()): Promise<BarberVerticalMetrics> {
  try {
    const monthStart = startOfMonth(now);
    const monthEnd = startOfNextMonth(now);
    const { prices, plans } = await loadPlanPrices();

    const [parents, branches, signups, lapsed, openTickets] = await Promise.all([
      prisma.barbershop.findMany({
        where: { parentId: null },
        select: { plan: true, subscriptionStatus: true },
      }),
      prisma.barbershop.count({ where: { parentId: { not: null }, isActive: true } }),
      prisma.barbershop.count({
        where: { parentId: null, createdAt: { gte: monthStart, lt: monthEnd } },
      }),
      prisma.barbershop.count({
        where: {
          parentId: null,
          subscriptionStatus: { in: LAPSED_STATUSES },
          updatedAt: { gte: monthStart, lt: monthEnd },
        },
      }),
      prisma.barberSupportTicket.findMany({
        where: { status: { not: "CLOSED" } },
        select: { id: true },
        take: 2000,
      }),
    ]);

    const perPlan = new Map<BarberPlanId, { accounts: number; active: number }>();
    for (const id of BARBER_PLAN_IDS) perPlan.set(id, { accounts: 0, active: 0 });

    let mrr = ZERO;
    let activeAccounts = 0;
    for (const shop of parents) {
      const planId = coercePlan(shop.plan);
      const bucket = perPlan.get(planId)!;
      bucket.accounts += 1;
      if (isBarbershopSubscriptionActive(shop)) {
        bucket.active += 1;
        activeAccounts += 1;
        mrr = mrr.add(prices[planId] ?? ZERO);
      }
    }

    const byPlan: BarberPlanBreakdown[] = plans.map((p) => {
      const bucket = perPlan.get(p.id) ?? { accounts: 0, active: 0 };
      const price = prices[p.id] ?? ZERO;
      return {
        planId: p.id,
        name: p.name,
        priceMonthly: price.toFixed(2),
        accounts: bucket.accounts,
        activeAccounts: bucket.active,
        mrr: price.mul(bucket.active).toFixed(2),
      };
    });

    const pendingReply = await countTicketsPendingReply(openTickets.map((t) => t.id));

    return {
      accounts: parents.length,
      activeAccounts,
      branches,
      mrrMonthly: mrr.toFixed(2),
      signupsThisMonth: signups,
      churnThisMonth: lapsed,
      churnIsApproximate: true,
      byPlan,
      openTickets: openTickets.length,
      ticketsPendingReply: pendingReply,
    };
  } catch (e) {
    console.error("[barber/admin] métricas del vertical no disponibles:", e);
    return EMPTY_METRICS;
  }
}

/**
 * Tickets abiertos cuyo ÚLTIMO mensaje no es de ADMIN (o que no tienen
 * ninguno). Se apoya en `lastMessageByTicket` a propósito: la regla de "quién
 * debe la respuesta" existe UNA sola vez, así el número de la lista y el de
 * la bandeja de soporte no pueden separarse con el tiempo.
 */
async function countTicketsPendingReply(ticketIds: string[]): Promise<number> {
  if (ticketIds.length === 0) return 0;
  const lastByTicket = await lastMessageByTicket(ticketIds);
  return ticketIds.filter((id) => lastByTicket.get(id)?.author !== "ADMIN").length;
}

// ── B. Ficha de una barbería ────────────────────────────────────────────

export interface AdminBarberTeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
  /** Nombre de la fila `Barber` cuando el usuario además atiende. */
  barberName: string | null;
}

export interface AdminBarberOperator {
  id: string;
  name: string;
  nickname: string | null;
  isActive: boolean;
  commissionType: string;
}

export interface AdminBarberBranch {
  id: string;
  name: string;
  branchName: string | null;
  city: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AdminBarberWhatsappUsage {
  mode: string;
  connected: boolean;
  verifiedAt: string | null;
  wabaId: string | null;
  /** Consumo de TODA la familia (matriz + sucursales). */
  usedPeriod: number;
  periodStart: string | null;
  /** -1 = ilimitado. Sale del plan (tabla), nunca de código. */
  quota: number;
  /** null cuando la cuota es ilimitada. */
  usedPct: number | null;
  sentLast30d: number;
  failedLast30d: number;
}

export interface AdminBarberActivity {
  appointmentsThisMonth: number;
  doneThisMonth: number;
  cancelledThisMonth: number;
  noShowThisMonth: number;
  ticketsThisMonth: number;
  openTickets: number;
  lastActivityAt: string | null;
  recentTickets: AdminBarberTicketRow[];
}

export interface AdminBarbershopDetail {
  shop: AdminBarbershopRow & {
    email: string | null;
    phone: string | null;
    address: string | null;
    timezone: string;
    teamSize: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    updatedAt: string;
  };
  plan: BarberResolvedPlan;
  /** Catálogo completo, para el selector de cambio manual de plan. */
  plans: BarberResolvedPlan[];
  team: AdminBarberTeamMember[];
  barbers: AdminBarberOperator[];
  branches: AdminBarberBranch[];
  whatsapp: AdminBarberWhatsappUsage;
  activity: AdminBarberActivity;
  /** null = la bitácora todavía no existe en BD (falta sql/barber_admin.sql). */
  manualActions: AdminBarberActionRow[] | null;
}

export async function getBarbershopDetailForAdmin(
  id: string,
  now: Date = new Date(),
): Promise<AdminBarbershopDetail | null> {
  const rows = await listBarbershopsForAdmin({ id });
  const base = rows[0] ?? null;

  const shop = await prisma.barbershop.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      timezone: true,
      teamSize: true,
      plan: true,
      subscriptionStatus: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      isActive: true,
      parentId: true,
      branchName: true,
      whatsappSenderMode: true,
      wabaId: true,
      phoneNumberId: true,
      whatsappVerifiedAt: true,
      messagesUsedPeriod: true,
      messagesPeriodStart: true,
      createdAt: true,
      updatedAt: true,
      parent: { select: { name: true } },
      _count: { select: { users: true } },
    },
  });
  if (!shop) return null;

  const planId = coercePlan(shop.plan);
  const plans = await getBarberPlans();
  const plan = plans.find((p) => p.id === planId) ?? plans[0];

  // Familia = esta fila + sus sedes hijas activas. El consumo de WhatsApp y la
  // actividad se miran de la familia entera porque el plan (y su cuota) los
  // cubre a todos.
  const branchRows = await prisma.barbershop.findMany({
    where: { parentId: shop.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      branchName: true,
      city: true,
      isActive: true,
      createdAt: true,
      messagesUsedPeriod: true,
    },
  });
  const familyIds = [shop.id, ...branchRows.filter((b) => b.isActive).map((b) => b.id)];

  const monthStart = startOfMonth(now);
  const monthEnd = startOfNextMonth(now);
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    team,
    barbers,
    apptGroups,
    ticketsThisMonth,
    openTickets,
    recentTicketRows,
    lastAppt,
    lastSale,
    lastLogin,
    waSent,
    waFailed,
  ] = await Promise.all([
    prisma.barberUser.findMany({
      where: { barbershopId: { in: familyIds } },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        barber: { select: { name: true } },
      },
    }),
    prisma.barber.findMany({
      where: { barbershopId: { in: familyIds } },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, nickname: true, isActive: true, commissionType: true },
    }),
    prisma.barberAppointment.groupBy({
      by: ["status"],
      where: { barbershopId: { in: familyIds }, startAt: { gte: monthStart, lt: monthEnd } },
      _count: { _all: true },
    }),
    prisma.barberSupportTicket.count({
      where: { barbershopId: { in: familyIds }, createdAt: { gte: monthStart, lt: monthEnd } },
    }),
    prisma.barberSupportTicket.count({
      where: { barbershopId: { in: familyIds }, status: { not: "CLOSED" } },
    }),
    prisma.barberSupportTicket.findMany({
      where: { barbershopId: { in: familyIds } },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
      select: {
        id: true,
        barbershopId: true,
        subject: true,
        category: true,
        status: true,
        priority: true,
        lastMessageAt: true,
        createdAt: true,
        createdByUserId: true,
      },
    }),
    prisma.barberAppointment.aggregate({
      where: { barbershopId: { in: familyIds } },
      _max: { createdAt: true },
    }),
    prisma.barberSale.aggregate({
      where: { barbershopId: { in: familyIds } },
      _max: { createdAt: true },
    }),
    prisma.barberUser.aggregate({
      where: { barbershopId: { in: familyIds } },
      _max: { lastLogin: true },
    }),
    prisma.barberMessage.count({
      where: {
        barbershopId: { in: familyIds },
        direction: "OUTBOUND",
        createdAt: { gte: last30 },
        status: { in: ["SENT", "DELIVERED", "READ"] },
      },
    }),
    prisma.barberMessage.count({
      where: {
        barbershopId: { in: familyIds },
        direction: "OUTBOUND",
        createdAt: { gte: last30 },
        status: "FAILED",
      },
    }),
  ]);

  const apptCount = (status: string) =>
    apptGroups.find((g) => g.status === status)?._count._all ?? 0;
  const appointmentsThisMonth = apptGroups.reduce((acc, g) => acc + g._count._all, 0);

  const usedPeriod =
    shop.messagesUsedPeriod +
    branchRows.filter((b) => b.isActive).reduce((acc, b) => acc + b.messagesUsedPeriod, 0);
  const quota = plan?.messageQuota ?? 0;

  const shopRow: AdminBarbershopRow = base ?? {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    city: shop.city,
    state: shop.state,
    plan: planId,
    planName: plan?.name ?? planId,
    planPriceMonthly: new Prisma.Decimal(String(plan?.priceMonthly ?? 0)).toFixed(2),
    subscriptionStatus: shop.subscriptionStatus,
    subscriptionActive: isBarbershopSubscriptionActive(shop),
    isActive: shop.isActive,
    createdAt: shop.createdAt.toISOString(),
    isBranch: shop.parentId !== null,
    branchName: shop.branchName,
    parentName: shop.parent?.name ?? null,
    branchCount: branchRows.filter((b) => b.isActive).length,
    barbers: barbers.filter((b) => b.isActive).length,
    teamUsers: shop._count.users,
    whatsappConnected: isWhatsappConnected(shop),
    whatsappMode: shop.whatsappSenderMode,
    messagesUsedPeriod: shop.messagesUsedPeriod,
    messageQuota: quota,
    lastActivityAt: null,
    openTickets,
  };

  const manualActions = await listBarberAdminActions(shop.id);

  return {
    shop: {
      ...shopRow,
      email: shop.email,
      phone: shop.phone,
      address: shop.address,
      timezone: shop.timezone,
      teamSize: shop.teamSize,
      stripeCustomerId: shop.stripeCustomerId,
      stripeSubscriptionId: shop.stripeSubscriptionId,
      updatedAt: shop.updatedAt.toISOString(),
    },
    plan: plan!,
    plans,
    team: team.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim() || u.email,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      lastLogin: iso(u.lastLogin),
      createdAt: u.createdAt.toISOString(),
      barberName: u.barber?.name ?? null,
    })),
    barbers: barbers.map((b) => ({
      id: b.id,
      name: b.name,
      nickname: b.nickname,
      isActive: b.isActive,
      commissionType: b.commissionType,
    })),
    branches: branchRows.map((b) => ({
      id: b.id,
      name: b.name,
      branchName: b.branchName,
      city: b.city,
      isActive: b.isActive,
      createdAt: b.createdAt.toISOString(),
    })),
    whatsapp: {
      mode: shop.whatsappSenderMode,
      connected: isWhatsappConnected(shop),
      verifiedAt: iso(shop.whatsappVerifiedAt),
      wabaId: shop.wabaId,
      usedPeriod,
      periodStart: iso(shop.messagesPeriodStart),
      quota,
      usedPct: quota > 0 ? Math.round((usedPeriod / quota) * 100) : null,
      sentLast30d: waSent,
      failedLast30d: waFailed,
    },
    activity: {
      appointmentsThisMonth,
      doneThisMonth: apptCount("DONE"),
      cancelledThisMonth: apptCount("CANCELLED"),
      noShowThisMonth: apptCount("NO_SHOW"),
      ticketsThisMonth,
      openTickets,
      lastActivityAt: iso(
        latest(
          lastAppt._max.createdAt,
          lastSale._max.createdAt,
          lastLogin._max.lastLogin,
          shop.createdAt,
        ),
      ),
      recentTickets: recentTicketRows.map((t) => ({
        id: t.id,
        barbershopId: t.barbershopId,
        barbershopName: shop.name,
        subject: t.subject,
        category: t.category,
        status: t.status as BarberTicketStatus,
        priority: t.priority as BarberTicketPriority,
        lastMessageAt: t.lastMessageAt.toISOString(),
        createdAt: t.createdAt.toISOString(),
        createdByName: null,
        needsReply: false,
        waitingHours: null,
        messages: 0,
      })),
    },
    manualActions,
  };
}

// ── B (acciones manuales) ───────────────────────────────────────────────

export type BarberAdminActionType = "SUSPEND" | "REACTIVATE" | "PLAN_CHANGE";

export interface AdminBarberActionRow {
  id: string;
  action: BarberAdminActionType;
  note: string;
  beforeValue: string | null;
  afterValue: string | null;
  actorEmail: string | null;
  createdAt: string;
}

export interface BarberAdminActor {
  id: string;
  email: string;
}

export interface BarberAdminActionResult {
  shop: { id: string; plan: BarberPlanId; subscriptionStatus: string };
  /** Sedes hijas a las que se propagó el cambio. */
  branchesUpdated: number;
  /** false = la acción se hizo pero NO quedó en la bitácora de BD. */
  audited: boolean;
}

function assertNote(note: unknown): string {
  const clean = typeof note === "string" ? note.trim() : "";
  if (clean.length < BARBER_ADMIN_NOTE_MIN) {
    throw new BarberAdminError(
      `La nota es obligatoria: explica por qué haces este cambio (mínimo ${BARBER_ADMIN_NOTE_MIN} caracteres).`,
      400,
    );
  }
  if (clean.length > BARBER_ADMIN_NOTE_MAX) {
    throw new BarberAdminError(`La nota no puede pasar de ${BARBER_ADMIN_NOTE_MAX} caracteres.`, 400);
  }
  return clean;
}

async function loadShopForAction(id: string) {
  const shop = await prisma.barbershop.findUnique({
    where: { id },
    select: { id: true, name: true, plan: true, subscriptionStatus: true, parentId: true },
  });
  if (!shop) throw new BarberAdminError("Barbería no encontrada", 404);
  if (shop.parentId) {
    throw new BarberAdminError(
      "Esta sede es una sucursal: el plan y la suscripción se cambian en su matriz.",
      400,
    );
  }
  return shop;
}

/**
 * Suspender / reactivar a mano. Escribe la matriz y PROPAGA a las sucursales,
 * igual que hace el webhook de Stripe (`applyBarberSubscription`), para que
 * una sede no quede abierta con la matriz suspendida.
 *
 * OJO (queda dicho en la UI): si la barbería tiene una suscripción viva en
 * Stripe, el siguiente evento de esa suscripción vuelve a escribir el estado
 * real y deshace la suspensión manual. Es una palanca de operación, no un
 * corte de cobro.
 */
export async function setBarbershopSuspension(
  id: string,
  input: { suspend: boolean; note: unknown; actor: BarberAdminActor },
): Promise<BarberAdminActionResult> {
  const note = assertNote(input.note);
  const shop = await loadShopForAction(id);

  const nextStatus = input.suspend
    ? BARBER_MANUAL_SUSPENDED_STATUS
    : BARBER_MANUAL_REACTIVATED_STATUS;

  if (shop.subscriptionStatus === nextStatus) {
    throw new BarberAdminError(
      input.suspend ? "La barbería ya está suspendida." : "La barbería ya está activa.",
      409,
    );
  }

  const [, branches] = await prisma.$transaction([
    prisma.barbershop.update({
      where: { id: shop.id },
      data: { subscriptionStatus: nextStatus },
    }),
    prisma.barbershop.updateMany({
      where: { parentId: shop.id },
      data: { subscriptionStatus: nextStatus },
    }),
  ]);

  const audited = await recordBarberAdminAction({
    barbershopId: shop.id,
    action: input.suspend ? "SUSPEND" : "REACTIVATE",
    note,
    beforeValue: shop.subscriptionStatus,
    afterValue: nextStatus,
    actor: input.actor,
    shopName: shop.name,
  });

  return {
    shop: { id: shop.id, plan: coercePlan(shop.plan), subscriptionStatus: nextStatus },
    branchesUpdated: branches.count,
    audited,
  };
}

/**
 * Cambio MANUAL de plan. Mueve `plan` en la matriz y sus sucursales; NO toca
 * Stripe, así que el cobro sigue siendo el de la suscripción vigente hasta que
 * alguien la cambie desde /barber/suscripcion. La UI lo dice con todas sus
 * letras.
 */
export async function changeBarbershopPlan(
  id: string,
  input: { plan: unknown; note: unknown; actor: BarberAdminActor },
): Promise<BarberAdminActionResult> {
  const note = assertNote(input.note);
  if (!isBarberPlanId(input.plan)) throw new BarberAdminError("Plan inválido", 400);
  const nextPlan = input.plan;

  const shop = await loadShopForAction(id);
  if (coercePlan(shop.plan) === nextPlan) {
    throw new BarberAdminError("La barbería ya está en ese plan.", 409);
  }

  const [, branches] = await prisma.$transaction([
    prisma.barbershop.update({ where: { id: shop.id }, data: { plan: nextPlan } }),
    prisma.barbershop.updateMany({ where: { parentId: shop.id }, data: { plan: nextPlan } }),
  ]);

  const audited = await recordBarberAdminAction({
    barbershopId: shop.id,
    action: "PLAN_CHANGE",
    note,
    beforeValue: shop.plan,
    afterValue: nextPlan,
    actor: input.actor,
    shopName: shop.name,
  });

  return {
    shop: { id: shop.id, plan: nextPlan, subscriptionStatus: shop.subscriptionStatus },
    branchesUpdated: branches.count,
    audited,
  };
}

// ── Bitácora de acciones manuales ───────────────────────────────────────
//
// `barber_admin_actions` vive en sql/barber_admin.sql y se lee/escribe con SQL
// crudo parametrizado: el contrato de esta terminal prohíbe tocar
// prisma/schema.prisma. Mientras el .sql no esté aplicado, la acción SIGUE
// ocurriendo y la ficha avisa que no quedó registrada — pero el rastro
// estructurado se emite igual por consola, que en Vercel sí se conserva.

function isMissingRelation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const meta = (err as { meta?: { code?: string } })?.meta?.code;
  return meta === "42P01" || /barber_admin_actions/i.test(msg);
}

async function recordBarberAdminAction(entry: {
  barbershopId: string;
  action: BarberAdminActionType;
  note: string;
  beforeValue: string | null;
  afterValue: string | null;
  actor: BarberAdminActor;
  shopName: string;
}): Promise<boolean> {
  // Rastro en logs SIEMPRE, aplique o no el .sql.
  console.info(
    "[barber/admin-action]",
    JSON.stringify({
      shopId: entry.barbershopId,
      shop: entry.shopName,
      action: entry.action,
      before: entry.beforeValue,
      after: entry.afterValue,
      actor: entry.actor.email,
      actorId: entry.actor.id,
      note: entry.note,
      at: new Date().toISOString(),
    }),
  );

  try {
    await prisma.$executeRaw`
      INSERT INTO barber_admin_actions
        (id, barbershop_id, action, note, before_value, after_value, actor_admin_id, actor_email)
      VALUES
        (gen_random_uuid()::text, ${entry.barbershopId}, ${entry.action}, ${entry.note},
         ${entry.beforeValue}, ${entry.afterValue}, ${entry.actor.id}, ${entry.actor.email})
    `;
    return true;
  } catch (e) {
    if (isMissingRelation(e)) {
      console.warn(
        "[barber/admin] bitácora no disponible: falta aplicar sql/barber_admin.sql",
      );
      return false;
    }
    console.error("[barber/admin] no se pudo escribir la bitácora:", e);
    return false;
  }
}

/** Historial de acciones manuales. `null` = la tabla todavía no existe. */
export async function listBarberAdminActions(
  barbershopId: string,
): Promise<AdminBarberActionRow[] | null> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        action: string;
        note: string;
        before_value: string | null;
        after_value: string | null;
        actor_email: string | null;
        created_at: Date;
      }>
    >`
      SELECT id, action, note, before_value, after_value, actor_email, created_at
      FROM barber_admin_actions
      WHERE barbershop_id = ${barbershopId}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return rows.map((r) => ({
      id: r.id,
      action: r.action as BarberAdminActionType,
      note: r.note,
      beforeValue: r.before_value,
      afterValue: r.after_value,
      actorEmail: r.actor_email,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  } catch (e) {
    if (!isMissingRelation(e)) console.error("[barber/admin] bitácora ilegible:", e);
    return null;
  }
}

// ── C. Soporte del vertical ─────────────────────────────────────────────

export interface AdminBarberTicketRow {
  id: string;
  barbershopId: string;
  barbershopName: string;
  subject: string;
  category: string;
  status: BarberTicketStatus;
  priority: BarberTicketPriority;
  lastMessageAt: string;
  createdAt: string;
  createdByName: string | null;
  /** true = la última palabra la tiene la barbería (o nadie ha contestado). */
  needsReply: boolean;
  /** Horas esperando respuesta de DaleControl; null si no aplica. */
  waitingHours: number | null;
  messages: number;
}

export interface AdminBarberSupportMetrics {
  open: number;
  pendingReply: number;
  unanswered24h: number;
  closedThisMonth: number;
}

export interface AdminBarberTicketFilters {
  /** Un solo ticket (lo usa el cambio de estado para devolver su fila). */
  id?: string | null;
  /** "OPEN" (pseudo-valor: todos los no cerrados) | un BarberTicketStatus */
  status?: string | null;
  priority?: string | null;
  category?: string | null;
  barbershopId?: string | null;
  q?: string | null;
}

const TICKET_STATUSES: BarberTicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_REPLY", "CLOSED"];
const TICKET_PRIORITIES: BarberTicketPriority[] = ["LOW", "NORMAL", "HIGH"];

function assertTicketStatus(v: string): BarberTicketStatus {
  if (!(TICKET_STATUSES as string[]).includes(v)) throw new BarberAdminError("Estado inválido", 400);
  return v as BarberTicketStatus;
}

function assertTicketPriority(v: string): BarberTicketPriority {
  if (!(TICKET_PRIORITIES as string[]).includes(v)) {
    throw new BarberAdminError("Prioridad inválida", 400);
  }
  return v as BarberTicketPriority;
}

/**
 * Bandeja de tickets de TODAS las barberías, ordenada por el más viejo sin
 * responder: primero los que esperan a DaleControl (más espera arriba) y
 * después el resto por actividad reciente.
 */
export async function listAdminBarberTickets(
  filters: AdminBarberTicketFilters = {},
): Promise<AdminBarberTicketRow[]> {
  const where: Prisma.BarberSupportTicketWhereInput = {};

  if (filters.id) where.id = filters.id;
  if (filters.status === "OPEN") where.status = { not: "CLOSED" };
  else if (filters.status) where.status = assertTicketStatus(filters.status);

  if (filters.priority) where.priority = assertTicketPriority(filters.priority);
  if (filters.category) where.category = filters.category;
  if (filters.barbershopId) where.barbershopId = filters.barbershopId;

  const term = (filters.q ?? "").trim();
  if (term) where.subject = { contains: term, mode: "insensitive" };

  const tickets = await prisma.barberSupportTicket.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: TICKET_LIMIT,
    select: {
      id: true,
      barbershopId: true,
      subject: true,
      category: true,
      status: true,
      priority: true,
      lastMessageAt: true,
      createdAt: true,
      barbershop: { select: { name: true } },
      createdBy: { select: { firstName: true, lastName: true, email: true } },
      _count: { select: { messages: true } },
    },
  });

  if (tickets.length === 0) return [];

  const lastByTicket = await lastMessageByTicket(tickets.map((t) => t.id));
  const now = Date.now();

  const rows: AdminBarberTicketRow[] = tickets.map((t) => {
    const last = lastByTicket.get(t.id);
    // Nadie contestó todavía, o el último turno fue de la barbería.
    const needsReply = t.status !== "CLOSED" && (!last || last.author !== "ADMIN");
    const since = last?.at ?? t.createdAt;
    return {
      id: t.id,
      barbershopId: t.barbershopId,
      barbershopName: t.barbershop?.name ?? "Barbería eliminada",
      subject: t.subject,
      category: t.category,
      status: t.status as BarberTicketStatus,
      priority: t.priority as BarberTicketPriority,
      lastMessageAt: t.lastMessageAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
      createdByName: t.createdBy
        ? `${t.createdBy.firstName} ${t.createdBy.lastName}`.trim() || t.createdBy.email
        : null,
      needsReply,
      waitingHours: needsReply ? Math.round(((now - since.getTime()) / 36e5) * 10) / 10 : null,
      messages: t._count.messages,
    };
  });

  // El más viejo sin responder, arriba.
  return rows.sort((a, b) => {
    if (a.needsReply !== b.needsReply) return a.needsReply ? -1 : 1;
    if (a.needsReply && b.needsReply) return (b.waitingHours ?? 0) - (a.waitingHours ?? 0);
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });
}

/** Último mensaje de cada ticket (autor + fecha) en una sola query agregada. */
async function lastMessageByTicket(
  ticketIds: string[],
): Promise<Map<string, { at: Date; author: BarberTicketAuthor }>> {
  const out = new Map<string, { at: Date; author: BarberTicketAuthor }>();
  if (ticketIds.length === 0) return out;
  const rows = await prisma.barberSupportMessage.groupBy({
    by: ["ticketId", "authorType"],
    where: { ticketId: { in: ticketIds } },
    _max: { createdAt: true },
  });
  for (const r of rows) {
    const at = r._max.createdAt;
    if (!at) continue;
    const prev = out.get(r.ticketId);
    if (!prev || at.getTime() > prev.at.getTime()) {
      out.set(r.ticketId, { at, author: r.authorType as BarberTicketAuthor });
    }
  }
  return out;
}

export async function getBarberSupportMetrics(
  now: Date = new Date(),
): Promise<AdminBarberSupportMetrics> {
  try {
    const monthStart = startOfMonth(now);
    const monthEnd = startOfNextMonth(now);
    const [open, closedThisMonth] = await Promise.all([
      prisma.barberSupportTicket.findMany({
        where: { status: { not: "CLOSED" } },
        select: { id: true, createdAt: true },
        take: 2000,
      }),
      prisma.barberSupportTicket.count({
        where: { status: "CLOSED", closedAt: { gte: monthStart, lt: monthEnd } },
      }),
    ]);

    const lastByTicket = await lastMessageByTicket(open.map((t) => t.id));
    const cutoff = now.getTime() - 24 * 36e5;
    let pendingReply = 0;
    let unanswered24h = 0;
    for (const t of open) {
      const last = lastByTicket.get(t.id);
      if (last && last.author === "ADMIN") continue;
      pendingReply += 1;
      const since = last?.at ?? t.createdAt;
      if (since.getTime() < cutoff) unanswered24h += 1;
    }

    return { open: open.length, pendingReply, unanswered24h, closedThisMonth };
  } catch (e) {
    console.error("[barber/admin] métricas de soporte no disponibles:", e);
    return { open: 0, pendingReply: 0, unanswered24h: 0, closedThisMonth: 0 };
  }
}

export interface AdminBarberMessageDTO {
  id: string;
  ticketId: string;
  authorType: BarberTicketAuthor;
  authorName: string | null;
  body: string;
  attachments: Array<BarberSupportAttachment & { signedUrl?: string }>;
  createdAt: string;
}

export interface AdminBarberTicketDetail {
  ticket: AdminBarberTicketRow & {
    barbershopSlug: string;
    barbershopPlan: BarberPlanId;
    barbershopStatus: string;
    createdByEmail: string | null;
    closedAt: string | null;
  };
  messages: AdminBarberMessageDTO[];
}

function parseAttachments(raw: unknown): BarberSupportAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
    .filter((a) => typeof a.path === "string")
    .map((a) => ({
      path: String(a.path),
      name: typeof a.name === "string" ? a.name : "archivo",
      size: typeof a.size === "number" ? a.size : 0,
      type: typeof a.type === "string" ? a.type : "application/octet-stream",
    }));
}

let cachedStorage: ReturnType<typeof createSupabaseAdmin> | null = null;
function storageAdmin() {
  if (!cachedStorage) {
    cachedStorage = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return cachedStorage;
}

/**
 * Firma TODOS los adjuntos del hilo en un solo round-trip contra
 * `barber-files` (bucket PRIVADO). Falla SUAVE: un adjunto que no se pueda
 * firmar se muestra sin enlace en vez de tumbar el ticket.
 */
async function signAttachments(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  try {
    const { data, error } = await storageAdmin()
      .storage.from(BARBER_FILES_BUCKET)
      .createSignedUrls(paths, ATTACHMENT_URL_TTL_SECONDS);
    if (error || !data) {
      console.warn("[barber/admin] no se pudieron firmar adjuntos:", error?.message);
      return out;
    }
    data.forEach((row, i) => {
      const path = paths[i];
      if (path && row.signedUrl) out.set(path, row.signedUrl);
    });
  } catch (e) {
    console.warn("[barber/admin] excepción al firmar adjuntos:", (e as Error).message);
  }
  return out;
}

export async function getBarberTicketForAdmin(
  ticketId: string,
): Promise<AdminBarberTicketDetail | null> {
  const ticket = await prisma.barberSupportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      barbershopId: true,
      subject: true,
      category: true,
      status: true,
      priority: true,
      lastMessageAt: true,
      createdAt: true,
      closedAt: true,
      barbershop: { select: { name: true, slug: true, plan: true, subscriptionStatus: true } },
      createdBy: { select: { firstName: true, lastName: true, email: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        take: THREAD_LIMIT,
        select: {
          id: true,
          ticketId: true,
          authorType: true,
          authorUserId: true,
          body: true,
          attachments: true,
          createdAt: true,
        },
      },
    },
  });
  if (!ticket) return null;

  // Nombres de los autores SHOP en una sola query (los ADMIN no llevan FK).
  const shopAuthorIds = Array.from(
    new Set(
      ticket.messages
        .filter((m) => m.authorType === "SHOP" && m.authorUserId)
        .map((m) => m.authorUserId as string),
    ),
  );
  const authors =
    shopAuthorIds.length > 0
      ? await prisma.barberUser.findMany({
          where: { id: { in: shopAuthorIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
  const authorName = new Map(
    authors.map((a) => [a.id, `${a.firstName} ${a.lastName}`.trim() || a.email]),
  );

  const parsed = ticket.messages.map((m) => ({ m, atts: parseAttachments(m.attachments) }));
  const signed = await signAttachments(parsed.flatMap((p) => p.atts.map((a) => a.path)));

  const last = parsed.length > 0 ? parsed[parsed.length - 1].m : null;
  const needsReply = ticket.status !== "CLOSED" && (!last || last.authorType !== "ADMIN");
  const since = last?.createdAt ?? ticket.createdAt;

  return {
    ticket: {
      id: ticket.id,
      barbershopId: ticket.barbershopId,
      barbershopName: ticket.barbershop?.name ?? "Barbería eliminada",
      barbershopSlug: ticket.barbershop?.slug ?? "",
      barbershopPlan: coercePlan(ticket.barbershop?.plan),
      barbershopStatus: ticket.barbershop?.subscriptionStatus ?? "—",
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status as BarberTicketStatus,
      priority: ticket.priority as BarberTicketPriority,
      lastMessageAt: ticket.lastMessageAt.toISOString(),
      createdAt: ticket.createdAt.toISOString(),
      closedAt: iso(ticket.closedAt),
      createdByName: ticket.createdBy
        ? `${ticket.createdBy.firstName} ${ticket.createdBy.lastName}`.trim() ||
          ticket.createdBy.email
        : null,
      createdByEmail: ticket.createdBy?.email ?? null,
      needsReply,
      waitingHours: needsReply
        ? Math.round(((Date.now() - since.getTime()) / 36e5) * 10) / 10
        : null,
      messages: parsed.length,
    },
    messages: parsed.map(({ m, atts }) => ({
      id: m.id,
      ticketId: m.ticketId,
      authorType: m.authorType as BarberTicketAuthor,
      authorName:
        m.authorType === "ADMIN"
          ? "Soporte DaleControl"
          : (m.authorUserId ? authorName.get(m.authorUserId) : null) ?? null,
      body: m.body,
      attachments: atts.map((a) => ({ ...a, signedUrl: signed.get(a.path) })),
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export const BARBER_ADMIN_REPLY_MAX = 5000;
export const BARBER_ADMIN_MAX_ATTACHMENTS = 5;

/**
 * Responder como DaleControl. Escribe `authorType = "ADMIN"` — la etiqueta
 * exacta que el lado de la barbería (/barber/soporte) usa para pintar el
 * mensaje como "soporte" — y deja el ticket en WAITING_REPLY (la pelota pasa
 * a la barbería), salvo que ya estuviera cerrado, en cuyo caso lo reabre.
 */
export async function addBarberAdminReply(
  ticketId: string,
  input: { body: unknown; attachments?: unknown; actor: BarberAdminActor },
): Promise<AdminBarberMessageDTO> {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) throw new BarberAdminError("El mensaje no puede ir vacío", 400);
  if (body.length > BARBER_ADMIN_REPLY_MAX) {
    throw new BarberAdminError(`El mensaje no puede pasar de ${BARBER_ADMIN_REPLY_MAX} caracteres.`, 400);
  }

  const ticket = await prisma.barberSupportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, barbershopId: true, status: true },
  });
  if (!ticket) throw new BarberAdminError("Ticket no encontrado", 404);

  const attachments = parseAttachments(input.attachments).slice(0, BARBER_ADMIN_MAX_ATTACHMENTS);
  // Los adjuntos suben bajo barber-support/<barbershopId>/…; se re-valida
  // contra el ticket cargado en el server, nunca contra lo que mande el body.
  const prefix = `${BARBER_SUPPORT_PREFIX}/${ticket.barbershopId}/`;
  // Prefijo correcto Y sin escapatoria: "…/<id>/../../otra/x.png" empieza por
  // el prefijo pero apunta fuera. Se rechazan ".." y las barras invertidas.
  const bad = attachments.find(
    (a) => !a.path.startsWith(prefix) || a.path.includes("..") || a.path.includes("\\"),
  );
  if (bad) throw new BarberAdminError("Adjunto de otra barbería", 400);

  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.barberSupportMessage.create({
      data: {
        ticketId: ticket.id,
        barbershopId: ticket.barbershopId,
        authorType: "ADMIN",
        authorUserId: input.actor.id,
        body,
        attachments: attachments as unknown as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        ticketId: true,
        authorType: true,
        authorUserId: true,
        body: true,
        attachments: true,
        createdAt: true,
      },
    }),
    prisma.barberSupportTicket.update({
      where: { id: ticket.id },
      data: {
        lastMessageAt: now,
        status: "WAITING_REPLY",
        ...(ticket.status === "CLOSED" ? { closedAt: null } : {}),
      },
    }),
  ]);

  const atts = parseAttachments(message.attachments);
  const signed = await signAttachments(atts.map((a) => a.path));

  return {
    id: message.id,
    ticketId: message.ticketId,
    authorType: "ADMIN",
    authorName: "Soporte DaleControl",
    body: message.body,
    attachments: atts.map((a) => ({ ...a, signedUrl: signed.get(a.path) })),
    createdAt: message.createdAt.toISOString(),
  };
}

export async function changeBarberTicketState(
  ticketId: string,
  input: { status?: unknown; priority?: unknown },
): Promise<AdminBarberTicketRow> {
  const data: Prisma.BarberSupportTicketUpdateInput = {};

  if (typeof input.status === "string" && input.status) {
    const status = assertTicketStatus(input.status);
    data.status = status;
    data.closedAt = status === "CLOSED" ? new Date() : null;
  }
  if (typeof input.priority === "string" && input.priority) {
    data.priority = assertTicketPriority(input.priority);
  }
  if (Object.keys(data).length === 0) throw new BarberAdminError("Nada que actualizar", 400);

  const exists = await prisma.barberSupportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });
  if (!exists) throw new BarberAdminError("Ticket no encontrado", 404);

  await prisma.barberSupportTicket.update({ where: { id: ticketId }, data });

  const [row] = await listAdminBarberTickets({ id: ticketId });
  if (!row) throw new BarberAdminError("Ticket no encontrado", 404);
  return row;
}

/** Catálogo de categorías (reexportado para que las rutas no lo redefinan). */
export { BARBER_TICKET_CATEGORIES };
