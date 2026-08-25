import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRealtyPlans, clearRealtyPlanConfigCache } from "@/lib/realty/plans";
import {
  REALTY_PLAN_IDS,
  REALTY_FEATURE_KEYS,
  REALTY_UNLIMITED,
  isRealtyPlanId,
  isRealtySubscriptionActive,
  type RealtyPlanId,
  type RealtyResolvedPlan,
} from "@/lib/realty/plan-shared";
import { REALTY_MODES, type RealtyMode } from "@/lib/realty/types";
import {
  REALTY_MANUAL_REACTIVATED_STATUS,
  REALTY_MANUAL_SUSPENDED_STATUS,
  isRealtyLiveSubscriptionStatus,
  getRealtyStripe,
  grantRealtyTrialDays,
  prismaRealtyBillingDb,
  REALTY_BILLING_ACCOUNT_SELECT,
  type RealtyBillingAccount,
} from "@/lib/realty/billing";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl INMUEBLES — capa de datos del panel interno /admin/inmobiliarias.
 * Espejo de src/lib/barber/admin.ts.
 *
 * REGLAS QUE ESTE ARCHIVO SOSTIENE
 *
 * 1. 🔴 NÚMEROS SEPARADOS POR VERTICAL. Ninguna consulta de aquí toca
 *    `Clinic`, `Barbershop` ni ningún modelo del dental o de barber. El MRR de
 *    inmuebles sale EXCLUSIVAMENTE de filas `realty_accounts` × precios de
 *    `realty_plan_configs`. Es imposible que arrastre una suscripción dental o
 *    de barbería: el aislamiento no es un `where`, es separación de tablas.
 *    Y al revés: /admin (dental) y /admin/barberias no ven estas filas.
 *
 * 2. DINERO EN DECIMAL. Los precios se leen como `Prisma.Decimal` desde
 *    `realty_plan_configs` y se suman con `.add()`. Nunca un `+` de floats
 *    sobre dinero, y NUNCA un precio escrito a mano.
 *
 * 3. LA CUENTA ES LA CUENTA. A diferencia de barber (matriz + sucursales en la
 *    misma tabla, donde había que filtrar `parentId: null` para no cobrar dos
 *    veces), aquí las oficinas son otro modelo (`RealtyOffice`). Cada fila de
 *    `realty_accounts` es un cliente y punto.
 *
 * 4. MRR ≠ ACCESO. `isRealtySubscriptionActive` (active | trialing | paid)
 *    responde "¿tiene acceso?". Para el MRR el filtro es `active` A SECAS:
 *    una cuenta en cortesía paga $0 y contarla infla el número.
 *
 * 5. LAS MÉTRICAS NUNCA LANZAN. Un fallo devuelve el bloque vacío y la página
 *    se pinta igual.
 * ═══════════════════════════════════════════════════════════════════════
 */

const LIST_LIMIT = 500;
export const REALTY_ADMIN_NOTE_MIN = 8;
export const REALTY_ADMIN_NOTE_MAX = 1000;

/** Estados que cuentan como baja del mes (aproximada). */
const LAPSED_STATUSES = [
  "canceled",
  "cancelled",
  "unpaid",
  "incomplete_expired",
  REALTY_MANUAL_SUSPENDED_STATUS,
];

const ZERO = new Prisma.Decimal(0);

export class RealtyAdminError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "RealtyAdminError";
    this.status = status;
  }
}

export interface RealtyAdminActor {
  id: string;
  email: string;
}

function coercePlan(plan: string | null | undefined): RealtyPlanId {
  return isRealtyPlanId(plan) ? plan : "PROPIETARIO";
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfNextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

/**
 * Precios como Decimal, leídos DIRECTO de la tabla (getRealtyPlans los
 * normaliza a number para la UI, y aquí se quiere la precisión exacta).
 */
async function loadRealtyPlanPrices(): Promise<{
  prices: Record<RealtyPlanId, Prisma.Decimal>;
  plans: RealtyResolvedPlan[];
}> {
  const plans = await getRealtyPlans();
  const prices = {} as Record<RealtyPlanId, Prisma.Decimal>;
  for (const p of plans) prices[p.id] = new Prisma.Decimal(String(p.priceMonthly));

  try {
    const rows = await prisma.realtyPlanConfig.findMany({
      select: { planId: true, priceMonthly: true },
    });
    for (const row of rows) {
      if (isRealtyPlanId(row.planId)) {
        prices[row.planId] = new Prisma.Decimal(row.priceMonthly as unknown as string);
      }
    }
  } catch (e) {
    // Tabla aún sin migrar: se queda el precio del plan resuelto (= seed).
    console.warn("[realty/admin] realty_plan_configs no disponible:", e);
  }
  return { prices, plans };
}

// ═══════════════════════════════════════════════════════════════════════
// A. LISTADO
// ═══════════════════════════════════════════════════════════════════════

export interface AdminRealtyFilters {
  id?: string;
  q?: string;
  plan?: string;
  mode?: string;
  /** "active" | "inactive" | un estado crudo de Stripe. */
  status?: string;
}

export interface AdminRealtyAccountRow {
  id: string;
  name: string;
  slug: string;
  mode: RealtyMode;
  city: string | null;
  state: string | null;
  email: string | null;
  phone: string | null;
  plan: RealtyPlanId;
  planName: string;
  subscriptionStatus: string;
  subscriptionActive: boolean;
  isActive: boolean;
  hasStripeCustomer: boolean;
  hasStripeSubscription: boolean;
  createdAt: string;
  users: number;
  offices: number;
  properties: number;
  storageUsedBytes: number;
  storageQuotaMb: number;
  messageQuota: number;
  messagesUsedPeriod: number;
  openTickets: number;
  lastActivityAt: string | null;
}

export async function listRealtyAccountsForAdmin(
  filters: AdminRealtyFilters = {},
): Promise<AdminRealtyAccountRow[]> {
  const where: Prisma.RealtyAccountWhereInput = {};

  if (filters.id) where.id = filters.id;
  if (filters.plan && isRealtyPlanId(filters.plan)) where.plan = filters.plan;
  if (filters.mode && (REALTY_MODES as readonly string[]).includes(filters.mode)) {
    where.mode = filters.mode as RealtyMode;
  }

  if (filters.status === "active") {
    where.subscriptionStatus = { in: ["active", "trialing", "paid"] };
  } else if (filters.status === "inactive") {
    where.subscriptionStatus = { notIn: ["active", "trialing", "paid"] };
  } else if (filters.status) {
    where.subscriptionStatus = filters.status;
  }

  const term = (filters.q ?? "").trim();
  if (term) {
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { slug: { contains: term, mode: "insensitive" } },
      { city: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
    ];
  }

  const accounts = await prisma.realtyAccount.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: {
      id: true,
      name: true,
      slug: true,
      mode: true,
      city: true,
      state: true,
      email: true,
      phone: true,
      plan: true,
      subscriptionStatus: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      isActive: true,
      createdAt: true,
      storageUsedBytes: true,
      messageQuota: true,
      messagesUsedPeriod: true,
    },
  });
  if (accounts.length === 0) return [];

  const ids = accounts.map((a) => a.id);
  const { plans } = await loadRealtyPlanPrices();
  const planById = new Map(plans.map((p) => [p.id, p]));

  // Anti N+1: una consulta base + agregados en paralelo, resueltos a Map.
  // Cero `include` por fila.
  const [userCounts, officeCounts, propertyCounts, ticketCounts, lastLogin] =
    await Promise.all([
      prisma.realtyUser.groupBy({
        by: ["accountId"],
        where: { accountId: { in: ids }, active: true },
        _count: { _all: true },
      }),
      prisma.realtyOffice.groupBy({
        by: ["accountId"],
        where: { accountId: { in: ids }, isActive: true },
        _count: { _all: true },
      }),
      prisma.realtyProperty.groupBy({
        by: ["accountId"],
        where: { accountId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.realtySupportTicket.groupBy({
        by: ["accountId"],
        where: { accountId: { in: ids }, status: { not: "CLOSED" } },
        _count: { _all: true },
      }),
      prisma.realtyUser.groupBy({
        by: ["accountId"],
        where: { accountId: { in: ids } },
        _max: { lastLogin: true },
      }),
    ]);

  const users = new Map(userCounts.map((r) => [r.accountId, r._count._all]));
  const offices = new Map(officeCounts.map((r) => [r.accountId, r._count._all]));
  const properties = new Map(propertyCounts.map((r) => [r.accountId, r._count._all]));
  const tickets = new Map(ticketCounts.map((r) => [r.accountId, r._count._all]));
  const logins = new Map(lastLogin.map((r) => [r.accountId, r._max.lastLogin]));

  return accounts.map((a) => {
    const planId = coercePlan(a.plan);
    const plan = planById.get(planId);
    return {
      id: a.id,
      name: a.name,
      slug: a.slug,
      mode: a.mode,
      city: a.city,
      state: a.state,
      email: a.email,
      phone: a.phone,
      plan: planId,
      planName: plan?.name ?? planId,
      subscriptionStatus: a.subscriptionStatus,
      subscriptionActive: isRealtySubscriptionActive(a),
      isActive: a.isActive,
      hasStripeCustomer: !!a.stripeCustomerId,
      hasStripeSubscription: !!a.stripeSubscriptionId,
      createdAt: a.createdAt.toISOString(),
      users: users.get(a.id) ?? 0,
      offices: offices.get(a.id) ?? 0,
      properties: properties.get(a.id) ?? 0,
      // 🔴 BigInt: JSON.stringify revienta sin Number().
      storageUsedBytes: Number(a.storageUsedBytes),
      storageQuotaMb: plan?.storageQuotaMb ?? 0,
      // La columna de la cuenta PISA la del plan (null = manda el plan).
      messageQuota: a.messageQuota ?? plan?.messageQuota ?? 0,
      messagesUsedPeriod: a.messagesUsedPeriod,
      openTickets: tickets.get(a.id) ?? 0,
      lastActivityAt: logins.get(a.id)?.toISOString() ?? null,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// B. MÉTRICAS DEL VERTICAL — AISLADAS del dental y de barber
// ═══════════════════════════════════════════════════════════════════════

export interface RealtyPlanBreakdown {
  planId: RealtyPlanId;
  name: string;
  /** Decimal como string: el cliente nunca opera con floats sobre dinero. */
  priceMonthly: string;
  accounts: number;
  /** Con ACCESO (active | trialing | paid). Incluye cortesías, que pagan $0. */
  activeAccounts: number;
  /** Las que de verdad COBRAN (solo "active"). Es la base del MRR. */
  billableAccounts: number;
  mrr: string;
}

export interface RealtyModeBreakdown {
  mode: RealtyMode;
  accounts: number;
  activeAccounts: number;
}

export interface RealtyVerticalMetrics {
  accounts: number;
  activeAccounts: number;
  offices: number;
  properties: number;
  /** MRR SOLO de inmuebles, en pesos, como string decimal. */
  mrrMonthly: string;
  signupsThisMonth: number;
  churnThisMonth: number;
  /** Se calcula por `updatedAt`, así que es una aproximación y se dice. */
  churnIsApproximate: true;
  byPlan: RealtyPlanBreakdown[];
  byMode: RealtyModeBreakdown[];
  openTickets: number;
  pendingPayment: number;
}

export const EMPTY_REALTY_METRICS: RealtyVerticalMetrics = {
  accounts: 0,
  activeAccounts: 0,
  offices: 0,
  properties: 0,
  mrrMonthly: "0.00",
  signupsThisMonth: 0,
  churnThisMonth: 0,
  churnIsApproximate: true,
  byPlan: [],
  byMode: [],
  openTickets: 0,
  pendingPayment: 0,
};

export async function getRealtyVerticalMetrics(
  now: Date = new Date(),
): Promise<RealtyVerticalMetrics> {
  try {
    const monthStart = startOfMonth(now);
    const monthEnd = startOfNextMonth(now);
    const { prices, plans } = await loadRealtyPlanPrices();

    const [rows, offices, properties, signups, lapsed, openTickets] = await Promise.all([
      prisma.realtyAccount.findMany({
        select: { plan: true, subscriptionStatus: true, mode: true },
      }),
      prisma.realtyOffice.count({ where: { isActive: true } }),
      prisma.realtyProperty.count(),
      prisma.realtyAccount.count({
        where: { createdAt: { gte: monthStart, lt: monthEnd } },
      }),
      prisma.realtyAccount.count({
        where: {
          subscriptionStatus: { in: LAPSED_STATUSES },
          updatedAt: { gte: monthStart, lt: monthEnd },
        },
      }),
      prisma.realtySupportTicket.count({ where: { status: { not: "CLOSED" } } }),
    ]);

    const perPlan = new Map<
      RealtyPlanId,
      { accounts: number; active: number; billable: number }
    >();
    for (const id of REALTY_PLAN_IDS) {
      perPlan.set(id, { accounts: 0, active: 0, billable: 0 });
    }
    const perMode = new Map<RealtyMode, { accounts: number; active: number }>();
    for (const m of REALTY_MODES) perMode.set(m, { accounts: 0, active: 0 });

    let mrr = ZERO;
    let activeAccounts = 0;
    let pendingPayment = 0;

    for (const row of rows) {
      const planId = coercePlan(row.plan);
      const planBucket = perPlan.get(planId)!;
      const modeBucket = perMode.get(row.mode)!;
      planBucket.accounts += 1;
      modeBucket.accounts += 1;

      if (isRealtySubscriptionActive(row)) {
        activeAccounts += 1;
        planBucket.active += 1;
        modeBucket.active += 1;
      }
      if (row.subscriptionStatus === "pending_payment") pendingPayment += 1;

      // 🔴 MRR: SOLO "active". Una cuenta en cortesía ("trialing") paga $0 y
      // contarla inflaría el número — es el bug que ya costó caro en el dental.
      // El contador `billable` es el MISMO que alimenta el desglose por plan:
      // si el total usara un conjunto y el desglose otro, la suma de las
      // líneas no cuadraría con el total en la misma pantalla.
      if (row.subscriptionStatus === "active") {
        planBucket.billable += 1;
        mrr = mrr.add(prices[planId] ?? ZERO);
      }
    }

    const byPlan: RealtyPlanBreakdown[] = plans.map((p) => {
      const bucket = perPlan.get(p.id) ?? { accounts: 0, active: 0, billable: 0 };
      const price = prices[p.id] ?? ZERO;
      return {
        planId: p.id,
        name: p.name,
        priceMonthly: price.toFixed(2),
        accounts: bucket.accounts,
        activeAccounts: bucket.active,
        billableAccounts: bucket.billable,
        mrr: price.mul(bucket.billable).toFixed(2),
      };
    });

    const byMode: RealtyModeBreakdown[] = REALTY_MODES.map((m) => {
      const bucket = perMode.get(m) ?? { accounts: 0, active: 0 };
      return { mode: m, accounts: bucket.accounts, activeAccounts: bucket.active };
    });

    return {
      accounts: rows.length,
      activeAccounts,
      offices,
      properties,
      mrrMonthly: mrr.toFixed(2),
      signupsThisMonth: signups,
      churnThisMonth: lapsed,
      churnIsApproximate: true,
      byPlan,
      byMode,
      openTickets,
      pendingPayment,
    };
  } catch (e) {
    console.error("[realty/admin] métricas del vertical no disponibles:", e);
    return EMPTY_REALTY_METRICS;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// C. FICHA DE UNA CUENTA
// ═══════════════════════════════════════════════════════════════════════

export interface AdminRealtyUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  lastLogin: string | null;
}

export interface AdminRealtyOfficeRow {
  id: string;
  name: string;
  city: string | null;
  isMain: boolean;
  isActive: boolean;
}

export interface AdminRealtyActionRow {
  id: string;
  action: string;
  note: string;
  before: string | null;
  after: string | null;
  actorEmail: string | null;
  createdAt: string;
}

export interface AdminRealtyAccountDetail {
  account: AdminRealtyAccountRow;
  plan: RealtyResolvedPlan;
  /** Catálogo mínimo para el selector de plan: los NOMBRES salen de la tabla. */
  planOptions: { id: RealtyPlanId; name: string }[];
  users: AdminRealtyUserRow[];
  offices: AdminRealtyOfficeRow[];
  leads: number;
  leases: number;
  visitsThisMonth: number;
  openTickets: number;
  /** null = la tabla de bitácora aún no existe (falta el SQL). */
  actions: AdminRealtyActionRow[] | null;
  stripeConfigured: boolean;
}

export async function getRealtyAccountDetailForAdmin(
  id: string,
): Promise<AdminRealtyAccountDetail | null> {
  // Sin id, `listRealtyAccountsForAdmin` no aplicaría el filtro y devolvería
  // la cuenta más reciente del sistema en vez de un 404 (el clásico
  // `if (filters.id)` con string vacío).
  if (!id) return null;
  const rows = await listRealtyAccountsForAdmin({ id });
  const account = rows[0];
  if (!account) return null;

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = startOfNextMonth(now);
  const { plans } = await loadRealtyPlanPrices();
  const plan = plans.find((p) => p.id === account.plan) ?? plans[0];

  const [users, offices, leads, leases, visits, actions] = await Promise.all([
    prisma.realtyUser.findMany({
      where: { accountId: id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        active: true,
        lastLogin: true,
      },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      take: 60,
    }),
    prisma.realtyOffice.findMany({
      where: { accountId: id },
      select: { id: true, name: true, address: true, isMain: true, isActive: true },
      orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
      take: 40,
    }),
    prisma.realtyLead.count({ where: { accountId: id } }),
    prisma.realtyLease.count({ where: { accountId: id } }),
    prisma.realtyVisit.count({
      where: { accountId: id, createdAt: { gte: monthStart, lt: monthEnd } },
    }),
    listRealtyAdminActions(id),
  ]);

  return {
    account,
    plan,
    planOptions: plans.map((p) => ({ id: p.id, name: p.name })),
    users: users.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      email: u.email,
      role: u.role,
      active: u.active,
      lastLogin: u.lastLogin?.toISOString() ?? null,
    })),
    offices: offices.map((o) => ({
      id: o.id,
      name: o.name,
      city: o.address,
      isMain: o.isMain,
      isActive: o.isActive,
    })),
    leads,
    leases,
    visitsThisMonth: visits,
    openTickets: account.openTickets,
    actions,
    stripeConfigured: !!getRealtyStripe(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// D. BITÁCORA
// ═══════════════════════════════════════════════════════════════════════

function isMissingRelation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/realty_admin_actions/i.test(msg)) return true;
  const code = (err as { code?: string })?.code;
  // P2021 = tabla no existe · P2022 = columna no existe.
  return code === "P2021" || code === "P2022";
}

/**
 * Escribe la bitácora. Devuelve boolean en vez de lanzar: la acción se aplica
 * aunque el registro falle, y el `audited: false` viaja al cliente. El
 * `console.info` estructurado sale SIEMPRE, aplique o no el .sql.
 *
 * `RealtyAdminAction` guarda `payload Json`, no columnas note/before/after
 * como barber: la forma va dentro del payload.
 */
export async function recordRealtyAdminAction(entry: {
  accountId: string;
  action: string;
  note: string;
  before: string | null;
  after: string | null;
  actor: RealtyAdminActor;
  accountName: string;
  extra?: Record<string, unknown>;
}): Promise<boolean> {
  console.info(
    "[realty/admin-action]",
    JSON.stringify({
      accountId: entry.accountId,
      account: entry.accountName,
      action: entry.action,
      before: entry.before,
      after: entry.after,
      actor: entry.actor.email,
      actorId: entry.actor.id,
      note: entry.note,
      at: new Date().toISOString(),
      ...(entry.extra ?? {}),
    }),
  );

  try {
    await prisma.realtyAdminAction.create({
      data: {
        accountId: entry.accountId,
        adminUserId: entry.actor.id,
        action: entry.action,
        payload: {
          note: entry.note,
          before: entry.before,
          after: entry.after,
          actorEmail: entry.actor.email,
          ...(entry.extra ?? {}),
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return true;
  } catch (e) {
    if (isMissingRelation(e)) {
      console.warn("[realty/admin] bitácora no disponible: falta aplicar sql/realty.sql");
      return false;
    }
    console.error("[realty/admin] no se pudo escribir la bitácora:", e);
    return false;
  }
}

export async function listRealtyAdminActions(
  accountId: string,
): Promise<AdminRealtyActionRow[] | null> {
  try {
    const rows = await prisma.realtyAdminAction.findMany({
      where: { accountId },
      select: {
        id: true,
        action: true,
        payload: true,
        adminUserId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((r) => {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        action: r.action,
        note: typeof p.note === "string" ? p.note : "",
        before: typeof p.before === "string" ? p.before : null,
        after: typeof p.after === "string" ? p.after : null,
        actorEmail: typeof p.actorEmail === "string" ? p.actorEmail : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  } catch (e) {
    if (!isMissingRelation(e)) console.error("[realty/admin] bitácora ilegible:", e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// E. ACCIONES DE SOPORTE
// ═══════════════════════════════════════════════════════════════════════

function assertNote(note: unknown): string {
  const clean = typeof note === "string" ? note.trim() : "";
  if (clean.length < REALTY_ADMIN_NOTE_MIN) {
    throw new RealtyAdminError(
      `La nota es obligatoria: explica por qué haces este cambio (mínimo ${REALTY_ADMIN_NOTE_MIN} caracteres).`,
      400,
    );
  }
  if (clean.length > REALTY_ADMIN_NOTE_MAX) {
    throw new RealtyAdminError(
      `La nota no puede pasar de ${REALTY_ADMIN_NOTE_MAX} caracteres.`,
      400,
    );
  }
  return clean;
}

async function loadAccountForAction(id: string): Promise<RealtyBillingAccount> {
  const account = await prisma.realtyAccount.findUnique({
    where: { id },
    select: REALTY_BILLING_ACCOUNT_SELECT,
  });
  if (!account) throw new RealtyAdminError("Inmobiliaria no encontrada", 404);
  return account;
}

export interface RealtyAdminActionResult {
  account: { id: string; plan: RealtyPlanId; subscriptionStatus: string };
  audited: boolean;
  detail?: Record<string, unknown>;
}

/**
 * Suspensión MANUAL de soporte. Escribe "suspended", un estado que Stripe
 * nunca produce: así se distingue de un `past_due` (cobro fallido) y se puede
 * decir con honestidad "la suspendió DaleControl".
 */
export async function setRealtyAccountSuspension(
  id: string,
  input: { suspend: boolean; note: unknown; actor: RealtyAdminActor },
): Promise<RealtyAdminActionResult> {
  const note = assertNote(input.note);
  const account = await loadAccountForAction(id);

  let nextStatus: string = input.suspend
    ? REALTY_MANUAL_SUSPENDED_STATUS
    : REALTY_MANUAL_REACTIVATED_STATUS;

  // 🔴 Al REACTIVAR hay que resincronizar con Stripe. Mientras la cuenta
  // estuvo suspendida, el webhook NO escribió su estado (el candado manual lo
  // impide a propósito), así que la fila puede estar vieja: si Stripe canceló
  // la suscripción en ese tiempo, escribir "active" a ciegas devolvería el
  // acceso a alguien que ya no paga. Se pregunta y se escribe lo que Stripe
  // diga HOY.
  if (!input.suspend && account.stripeSubscriptionId) {
    const stripe = getRealtyStripe();
    if (stripe) {
      try {
        const sub = await stripe.subscriptions.retrieve(account.stripeSubscriptionId);
        nextStatus = sub.status;
      } catch {
        // Stripe sin responder: se queda en "active". Es una acción MANUAL de
        // un humano que ya decidió reactivar; dejarla fuera por un error de
        // red sería peor, y el siguiente evento del webhook la corrige.
      }
    }
  }

  if (account.subscriptionStatus === nextStatus) {
    throw new RealtyAdminError(
      input.suspend
        ? "La cuenta ya está suspendida."
        : `La cuenta ya está en "${nextStatus}": no hay nada que reactivar.`,
      409,
    );
  }

  await prisma.realtyAccount.update({
    where: { id: account.id },
    data: { subscriptionStatus: nextStatus },
  });

  const audited = await recordRealtyAdminAction({
    accountId: account.id,
    action: input.suspend ? "SUSPEND" : "REACTIVATE",
    note,
    before: account.subscriptionStatus,
    after: nextStatus,
    actor: input.actor,
    accountName: account.name,
  });

  return {
    account: {
      id: account.id,
      plan: coercePlan(account.plan),
      subscriptionStatus: nextStatus,
    },
    audited,
  };
}

/**
 * Cambio de plan DESDE SOPORTE. Solo mueve la columna `plan`: no toca Stripe,
 * porque un cambio de precio real lo hace el cliente desde su pantalla (con
 * prorrateo). Esto es para casos de soporte, y la nota explica cuál.
 */
export async function changeRealtyAccountPlan(
  id: string,
  input: { plan: unknown; note: unknown; actor: RealtyAdminActor },
): Promise<RealtyAdminActionResult> {
  const note = assertNote(input.note);
  if (!isRealtyPlanId(input.plan)) throw new RealtyAdminError("Plan inválido", 400);
  const nextPlan = input.plan;

  const account = await loadAccountForAction(id);
  if (coercePlan(account.plan) === nextPlan) {
    throw new RealtyAdminError("La cuenta ya está en ese plan.", 409);
  }

  // 🔴 Si la cuenta PAGA por Stripe, su plan lo decide el precio que paga:
  // el webhook lo relee en cada evento de la suscripción (y hay uno
  // garantizado en cada renovación), así que un cambio solo en la columna se
  // revertiría solo en días, en silencio y sin quedar en la bitácora.
  // Antes se permitía y se documentaba como "no toca Stripe"; era mentira.
  if (
    account.stripeSubscriptionId &&
    isRealtyLiveSubscriptionStatus(account.subscriptionStatus)
  ) {
    throw new RealtyAdminError(
      "Esta cuenta paga por Stripe: su plan lo manda el precio que tiene contratado y este cambio se revertiría solo en la próxima renovación. " +
        "El cambio con prorrateo lo hace ella desde su pantalla de Suscripción. Si es una cortesía, usa Otorgar días.",
      409,
    );
  }

  await prisma.realtyAccount.update({
    where: { id: account.id },
    data: { plan: nextPlan },
  });

  const audited = await recordRealtyAdminAction({
    accountId: account.id,
    action: "PLAN_CHANGE",
    note,
    before: account.plan,
    after: nextPlan,
    actor: input.actor,
    accountName: account.name,
    extra: { stripeUntouched: true },
  });

  return {
    account: {
      id: account.id,
      plan: nextPlan,
      subscriptionStatus: account.subscriptionStatus,
    },
    audited,
  };
}

/**
 * Otorgar días de cortesía. Va por el TRIAL de Stripe, no por una bandera en
 * la base: así EXPIRA SOLO y el webhook escribe el desenlace. Sin columna
 * `trialEndsAt` en `realty_accounts`, una cortesía "a mano" sería eterna y
 * nadie se acordaría de apagarla.
 */
export async function grantRealtyAccountDays(
  id: string,
  input: { days: unknown; note: unknown; actor: RealtyAdminActor },
): Promise<RealtyAdminActionResult> {
  const note = assertNote(input.note);
  const days = Number(input.days);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    throw new RealtyAdminError("Los días deben ser un número de 1 a 365.", 400);
  }

  const stripe = getRealtyStripe();
  if (!stripe) {
    throw new RealtyAdminError(
      "El cobro en línea no está configurado: sin Stripe no se puede dar una cortesía que expire sola. " +
        "Configura REALTY_STRIPE_SECRET_KEY o usa Reactivar (que no tiene fecha de fin).",
      503,
    );
  }

  const account = await loadAccountForAction(id);
  const plans = await getRealtyPlans();

  const result = await grantRealtyTrialDays({
    stripe,
    db: prismaRealtyBillingDb(),
    account,
    days: Math.floor(days),
    plans,
  });

  const fresh = await loadAccountForAction(id);
  const audited = await recordRealtyAdminAction({
    accountId: account.id,
    action: "GRANT_DAYS",
    note,
    before: account.subscriptionStatus,
    after: fresh.subscriptionStatus,
    actor: input.actor,
    accountName: account.name,
    extra: {
      days: Math.floor(days),
      trialEndsAt: result.trialEndsAt,
      subscriptionCreated: result.created,
    },
  });

  return {
    account: {
      id: account.id,
      plan: coercePlan(fresh.plan),
      subscriptionStatus: fresh.subscriptionStatus,
    },
    audited,
    detail: { trialEndsAt: result.trialEndsAt, created: result.created },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// F. EDITOR DE realty_plan_configs — cambiar un precio = editar una fila
// ═══════════════════════════════════════════════════════════════════════

/** Campos numéricos enteros. -1 vale como "ilimitado" en los cupos. */
const LIMIT_FIELDS = ["maxUsers", "maxOffices", "maxProperties"] as const;
const COUNT_FIELDS = ["storageQuotaMb", "messageQuota", "sortOrder"] as const;

export interface RealtyPlanConfigPatch {
  name?: string;
  priceMonthly?: number;
  priceYearly?: number | null;
  maxUsers?: number;
  maxOffices?: number;
  maxProperties?: number;
  storageQuotaMb?: number;
  messageQuota?: number;
  features?: Record<string, boolean>;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * Valida el body del editor contra una LISTA BLANCA. Nunca se hace spread del
 * body sobre el update: un campo de más ahí es una escritura no auditada.
 */
export function parseRealtyPlanConfigPatch(body: Record<string, unknown>): RealtyPlanConfigPatch {
  const patch: RealtyPlanConfigPatch = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) throw new RealtyAdminError("El nombre del plan no puede quedar vacío.", 400);
    if (name.length > 60) throw new RealtyAdminError("El nombre es demasiado largo.", 400);
    patch.name = name;
  }

  if (body.priceMonthly !== undefined) {
    const n = Number(body.priceMonthly);
    if (!Number.isFinite(n) || n < 0) {
      throw new RealtyAdminError("El precio mensual debe ser un número mayor o igual a 0.", 400);
    }
    patch.priceMonthly = Math.round(n * 100) / 100;
  }

  if (body.priceYearly !== undefined) {
    if (body.priceYearly === null || body.priceYearly === "") {
      patch.priceYearly = null;
    } else {
      const n = Number(body.priceYearly);
      if (!Number.isFinite(n) || n < 0) {
        throw new RealtyAdminError("El precio anual debe ser un número mayor o igual a 0.", 400);
      }
      patch.priceYearly = Math.round(n * 100) / 100;
    }
  }

  for (const field of LIMIT_FIELDS) {
    if (body[field] === undefined) continue;
    const n = Number(body[field]);
    // -1 = ilimitado (REALTY_UNLIMITED). En inmuebles NO se usa null como en
    // el dental: el contrato de plan-shared dice -1.
    if (!Number.isInteger(n) || (n < 0 && n !== REALTY_UNLIMITED)) {
      throw new RealtyAdminError(
        `"${field}" debe ser un entero ≥ 0, o -1 para ilimitado.`,
        400,
      );
    }
    patch[field] = n;
  }

  for (const field of COUNT_FIELDS) {
    if (body[field] === undefined) continue;
    const n = Number(body[field]);
    if (!Number.isInteger(n) || n < 0) {
      throw new RealtyAdminError(`"${field}" debe ser un entero ≥ 0.`, 400);
    }
    patch[field] = n;
  }

  if (body.features !== undefined) {
    const raw = body.features;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new RealtyAdminError("Las features deben venir como objeto.", 400);
    }
    const src = raw as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    // Solo llaves del catálogo: una llave inventada aquí nunca gatearía nada
    // y quedaría como basura en el Json.
    for (const key of REALTY_FEATURE_KEYS) out[key] = src[key] === true;
    patch.features = out;
  }

  if (body.isActive !== undefined) patch.isActive = body.isActive === true;

  return patch;
}

export async function updateRealtyPlanConfig(
  planId: string,
  patch: RealtyPlanConfigPatch,
): Promise<{ planId: RealtyPlanId; before: unknown; after: unknown }> {
  if (!isRealtyPlanId(planId)) throw new RealtyAdminError("Plan inválido", 400);
  if (Object.keys(patch).length === 0) {
    throw new RealtyAdminError("No hay nada que cambiar.", 400);
  }

  const before = await prisma.realtyPlanConfig.findUnique({ where: { planId } });
  if (!before) {
    throw new RealtyAdminError(
      "Ese plan no está en realty_plan_configs. Aplica sql/realty.sql antes de editar precios.",
      404,
    );
  }

  const data: Prisma.RealtyPlanConfigUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.priceMonthly !== undefined) data.priceMonthly = new Prisma.Decimal(patch.priceMonthly);
  if (patch.priceYearly !== undefined) {
    data.priceYearly = patch.priceYearly === null ? null : new Prisma.Decimal(patch.priceYearly);
  }
  if (patch.maxUsers !== undefined) data.maxUsers = patch.maxUsers;
  if (patch.maxOffices !== undefined) data.maxOffices = patch.maxOffices;
  if (patch.maxProperties !== undefined) data.maxProperties = patch.maxProperties;
  if (patch.storageQuotaMb !== undefined) data.storageQuotaMb = patch.storageQuotaMb;
  if (patch.messageQuota !== undefined) data.messageQuota = patch.messageQuota;
  if (patch.features !== undefined) data.features = patch.features as Prisma.InputJsonValue;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  // Si cambia el precio, la lookup key vigente deja de coincidir: se limpia
  // para que el siguiente checkout resuelva (y cree) el precio correcto.
  if (patch.priceMonthly !== undefined) data.stripeLookupKey = null;

  const after = await prisma.realtyPlanConfig.update({ where: { planId }, data });

  // 🔴 La caché de plans.ts vive 60 s POR INSTANCIA. Sin esto, el precio nuevo
  // tardaría en verse y dos pestañas enseñarían números distintos.
  clearRealtyPlanConfigCache();

  const plain = (row: typeof after | typeof before) =>
    row
      ? {
          ...row,
          priceMonthly: Number(row.priceMonthly),
          priceYearly: row.priceYearly === null ? null : Number(row.priceYearly),
          updatedAt: row.updatedAt.toISOString(),
        }
      : null;

  return { planId, before: plain(before), after: plain(after) };
}

/** Los 3 planes crudos para el editor del admin (Decimal → number). */
export async function listRealtyPlanConfigsForAdmin(): Promise<RealtyResolvedPlan[]> {
  return getRealtyPlans();
}
