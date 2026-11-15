import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  BarberClientMembershipStatus,
  BarberPaymentMethod,
} from "@/lib/barber/types";
import { createCounterTicketTx } from "@/lib/barber/cash";
import { BarberCajaError } from "@/lib/barber/commissions";
import {
  BARBER_MEMBERSHIP_STRIPE_GRACE_DAYS,
  addDays,
  buildConsumeWhere,
  centsToMoney,
  computePeriodEnd,
  coverageReason,
  daysUntil,
  membershipLineDescription,
  membershipSaleLineDescription,
  membershipUrgency,
  moneyToCents,
  nextPeriodEnd,
  pickCoveredLine,
  pickCurrentPeriod,
  upcomingPeriods,
  remainingCuts,
  BARBER_MEMBERSHIP_LINE_PREFIX,
  BARBER_CASH_MEMBERSHIP_SUFFIX,
  type BarberClientMembershipView,
  type BarberMembershipPlanView,
  type MembershipCoverageLine,
  type MembershipCoverageResult,
  type MembershipPlanInput,
} from "@/lib/barber/memberships-core";

/**
 * DaleControl BARBER — membresías del CLIENTE FINAL (acceso a BD).
 *
 * Este es el módulo PÚBLICO de la ola: T3 (ticket/caja) y T5 (portal del
 * cliente) importan SIEMPRE desde aquí, nunca de `memberships-core` ni de
 * prisma directo. Todo lo puro se re-exporta al final del archivo.
 *
 * REGLAS QUE NO SE ROMPEN
 *  1. `barbershopId` llega SIEMPRE del contexto de sesión de quien llama
 *     (getBarberContext) y va en TODA lectura y escritura. Un `undefined` borra el
 *     filtro en Prisma: por eso cada función lo exige como string y lo valida.
 *  2. El descuento de un corte se decide EN EL SERVIDOR y es atómico: un solo
 *     UPDATE con el cupo dentro del WHERE. Jamás leer-y-luego-escribir.
 *  3. Dinero en Decimal/centavos enteros. Nunca float.
 */

// ═══════════════════════════════════════════════════════════════════════
// Errores tipados (las APIs los mapean a 400/404/409)
// ═══════════════════════════════════════════════════════════════════════

export class BarberMembershipError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "BarberMembershipError";
    this.code = code;
    this.status = status;
  }
}

function requireShop(barbershopId: string | null | undefined): string {
  if (!barbershopId || typeof barbershopId !== "string") {
    // Defensa dura: un undefined aquí borraría el filtro multi-tenant.
    throw new BarberMembershipError("NO_SHOP", "Falta la barbería en el contexto.", 401);
  }
  return barbershopId;
}

function toNumber(d: Prisma.Decimal | number | null | undefined): number {
  return d === null || d === undefined ? 0 : Number(d);
}

// ═══════════════════════════════════════════════════════════════════════
// A. Catálogo: los planes que la barbería vende
// ═══════════════════════════════════════════════════════════════════════

/** Planes de la barbería + cuántos clientes los tienen vigentes ahora. */
export async function listMembershipPlans(
  barbershopId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<BarberMembershipPlanView[]> {
  const shopId = requireShop(barbershopId);
  const now = new Date();

  const [plans, counts] = await Promise.all([
    prisma.barberMembership.findMany({
      where: { barbershopId: shopId, ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.barberClientMembership.groupBy({
      by: ["membershipId"],
      where: { barbershopId: shopId, status: "ACTIVE", endAt: { gt: now } },
      _count: { _all: true },
    }),
  ]);

  const byPlan = new Map(counts.map((c) => [c.membershipId, c._count._all]));

  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: toNumber(p.price),
    includedCuts: p.includedCuts,
    periodDays: p.periodDays,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    activeCount: byPlan.get(p.id) ?? 0,
  }));
}

export async function createMembershipPlan(
  barbershopId: string,
  input: MembershipPlanInput,
): Promise<string> {
  const shopId = requireShop(barbershopId);
  const created = await prisma.barberMembership.create({
    data: {
      barbershopId: shopId,
      name: input.name,
      description: input.description,
      price: new Prisma.Decimal(centsToMoney(input.priceCents)),
      includedCuts: input.includedCuts,
      periodDays: input.periodDays,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Editar un plan NO reescribe las suscripciones ya vendidas: el cliente que
 * pagó "2 cortes" conserva sus 2 cortes hasta que renueve. Solo el precio y
 * el cupo de las renovaciones futuras cambian.
 */
export async function updateMembershipPlan(
  barbershopId: string,
  membershipId: string,
  input: MembershipPlanInput,
): Promise<void> {
  const shopId = requireShop(barbershopId);
  const res = await prisma.barberMembership.updateMany({
    where: { id: membershipId, barbershopId: shopId },
    data: {
      name: input.name,
      description: input.description,
      price: new Prisma.Decimal(centsToMoney(input.priceCents)),
      includedCuts: input.includedCuts,
      periodDays: input.periodDays,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
  });
  if (res.count === 0) {
    throw new BarberMembershipError("PLAN_NOT_FOUND", "No encontramos esa membresía.", 404);
  }
}

export async function setMembershipPlanActive(
  barbershopId: string,
  membershipId: string,
  isActive: boolean,
): Promise<void> {
  const shopId = requireShop(barbershopId);
  const res = await prisma.barberMembership.updateMany({
    where: { id: membershipId, barbershopId: shopId },
    data: { isActive },
  });
  if (res.count === 0) {
    throw new BarberMembershipError("PLAN_NOT_FOUND", "No encontramos esa membresía.", 404);
  }
}

/**
 * Borrar un plan solo se permite si NADIE lo ha comprado nunca (la relación
 * es NoAction en el schema: la BD lo bloquearía de todos modos). Si ya tiene
 * historia, se retira con isActive=false y se conserva el registro.
 */
export async function deleteMembershipPlan(
  barbershopId: string,
  membershipId: string,
): Promise<void> {
  const shopId = requireShop(barbershopId);
  const sold = await prisma.barberClientMembership.count({
    where: { barbershopId: shopId, membershipId },
  });
  if (sold > 0) {
    throw new BarberMembershipError(
      "PLAN_IN_USE",
      "Esta membresía ya se vendió, no se puede borrar. Desactívala para dejar de ofrecerla.",
      409,
    );
  }
  const res = await prisma.barberMembership.deleteMany({
    where: { id: membershipId, barbershopId: shopId },
  });
  if (res.count === 0) {
    throw new BarberMembershipError("PLAN_NOT_FOUND", "No encontramos esa membresía.", 404);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// B. Suscripciones de clientes: venta, renovación, vencimiento
// ═══════════════════════════════════════════════════════════════════════

const CLIENT_MEMBERSHIP_INCLUDE = {
  client: { select: { id: true, name: true, phone: true } },
  membership: { select: { id: true, name: true, price: true, periodDays: true, includedCuts: true } },
} as const;

type ClientMembershipRow = Prisma.BarberClientMembershipGetPayload<{
  include: typeof CLIENT_MEMBERSHIP_INCLUDE;
}>;

function toClientMembershipView(row: ClientMembershipRow, now: Date): BarberClientMembershipView {
  const state = {
    status: row.status as BarberClientMembershipStatus,
    endAt: row.endAt,
    cutsUsed: row.cutsUsed,
    includedCuts: row.membership.includedCuts,
    paymentMethod: row.paymentMethod as BarberPaymentMethod,
    stripeSubscriptionId: row.stripeSubscriptionId,
  };
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    clientPhone: row.client.phone,
    membershipId: row.membershipId,
    membershipName: row.membership.name,
    status: row.status as BarberClientMembershipStatus,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    cutsUsed: row.cutsUsed,
    includedCuts: row.membership.includedCuts,
    remaining: remainingCuts(row.membership.includedCuts, row.cutsUsed),
    paymentMethod: row.paymentMethod as BarberPaymentMethod,
    autoRenew: Boolean(row.stripeSubscriptionId),
    urgency: membershipUrgency(state, now),
    daysLeft: daysUntil(row.endAt, now),
    price: toNumber(row.membership.price),
    periodDays: row.membership.periodDays,
  };
}

export type MembershipListFilter = "all" | "active" | "soon" | "expired";

/**
 * Marca VENCIDAS las que ya pasaron de fecha. Esto es lo que hace que una
 * membresía pagada en EFECTIVO venza sola, sin Stripe y sin cron: se barre al
 * abrir la pantalla o al leer la lista. Las de Stripe respetan la gracia para
 * no parpadear mientras entra el cobro de renovación.
 */
export async function sweepExpiredMemberships(barbershopId: string): Promise<number> {
  const shopId = requireShop(barbershopId);
  const now = new Date();

  const [manual, auto] = await Promise.all([
    prisma.barberClientMembership.updateMany({
      where: { barbershopId: shopId, status: "ACTIVE", endAt: { lte: now }, stripeSubscriptionId: null },
      data: { status: "EXPIRED" },
    }),
    prisma.barberClientMembership.updateMany({
      where: {
        barbershopId: shopId,
        status: "ACTIVE",
        endAt: { lte: addDays(now, -BARBER_MEMBERSHIP_STRIPE_GRACE_DAYS) },
        stripeSubscriptionId: { not: null },
      },
      data: { status: "EXPIRED" },
    }),
  ]);

  return manual.count + auto.count;
}

// ── Cadenas de periodos (D1): un cliente + un plan = una membresía ──────

type LiveRow = { id: string; clientId: string; membershipId: string; status: string; startAt: Date; endAt: Date; cutsUsed: number; paymentMethod?: string };

interface Chain {
  /** Periodo vigente (o el primero si ninguno ha empezado). */
  current: LiveRow;
  /** Periodos ya pagados que empiezan después del vigente. */
  next: LiveRow[];
  /** Fin del ÚLTIMO periodo pagado: con éste se decide «por vencer». */
  lastEnd: Date;
}

const chainKey = (r: { clientId: string; membershipId: string }) => `${r.clientId}:${r.membershipId}`;

/** Agrupa las filas vivas (ACTIVE/PAUSED sin vencer) por cliente + plan. */
function buildChains(live: LiveRow[], now: Date): Map<string, Chain> {
  const groups = new Map<string, LiveRow[]>();
  for (const r of live) {
    const k = chainKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out = new Map<string, Chain>();
  for (const [k, rows] of groups) {
    const sorted = [...rows].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const current = pickCurrentPeriod(sorted, now) ?? sorted[0];
    const next = sorted.filter((r) => r.id !== current.id && r.startAt.getTime() >= current.endAt.getTime());
    const lastEnd = sorted.reduce((m, r) => (r.endAt > m ? r.endAt : m), current.endAt);
    out.set(k, { current, next, lastEnd });
  }
  return out;
}

async function loadLiveChains(shopId: string, now: Date): Promise<Map<string, Chain>> {
  const live = await prisma.barberClientMembership.findMany({
    where: { barbershopId: shopId, status: { in: ["ACTIVE", "PAUSED"] }, endAt: { gt: now } },
    select: { id: true, clientId: true, membershipId: true, status: true, startAt: true, endAt: true, cutsUsed: true, paymentMethod: true },
    take: 5000,
  });
  return buildChains(live, now);
}

/** Lista para el dueño. `soon` y `expired` son las dos con las que sale a cobrar. */
export async function listClientMemberships(
  barbershopId: string,
  opts: { filter?: MembershipListFilter; q?: string; take?: number } = {},
): Promise<BarberClientMembershipView[]> {
  const shopId = requireShop(barbershopId);
  await sweepExpiredMemberships(shopId);

  const now = new Date();
  const filter = opts.filter ?? "all";
  const q = (opts.q ?? "").trim();
  const soonLimit = addDays(now, 7).getTime();

  const where: Prisma.BarberClientMembershipWhereInput = { barbershopId: shopId };

  // «Vigentes» y «por vencer» se deciden por el ÚLTIMO periodo pagado de cada
  // cadena (D1): quien ya renovó no está «por vencer». Por eso aquí solo se
  // pide lo vivo y la ventana de 7 días se aplica abajo.
  if (filter === "active" || filter === "soon") {
    where.status = "ACTIVE";
    where.endAt = { gt: now };
  } else if (filter === "expired") {
    where.OR = [{ status: "EXPIRED" }, { status: "ACTIVE", endAt: { lte: now } }];
  }

  if (q) {
    // Teléfono solo con 3 dígitos o más, como Caja (lookupClients) y Clientes:
    // antes bastaba UNO, así que «Ana 5» traía a todo cliente con un 5 en el
    // teléfono (pase 11: la prueba fallaba cuando el sufijo aleatorio llevaba
    // un dígito).
    const digits = q.replace(/\D/g, "");
    const search: Prisma.BarberClientMembershipWhereInput = {
      client: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      },
    };
    where.AND = [search];
  }

  const [rows, chains] = await Promise.all([
    prisma.barberClientMembership.findMany({
      where,
      include: CLIENT_MEMBERSHIP_INCLUDE,
      orderBy: [{ endAt: "asc" }],
      take: Math.min(500, Math.max(1, opts.take ?? 200)),
    }),
    loadLiveChains(shopId, now),
  ]);

  const out: BarberClientMembershipView[] = [];
  for (const r of rows) {
    const chain = chains.get(chainKey(r));
    // Un periodo próximo no es una membresía aparte: viaja dentro del vigente.
    if (chain && r.id !== chain.current.id && chain.next.some((n) => n.id === r.id)) continue;
    // Un periodo vencido de una cadena que sigue viva no es «vencida».
    if (filter === "expired" && chain) continue;
    if (chain && r.id === chain.current.id) {
      const lastEnd = chain.lastEnd.getTime();
      if (filter === "active" && lastEnd <= soonLimit) continue;
      if (filter === "soon" && lastEnd > soonLimit) continue;
      const view = toClientMembershipView(r, now);
      if (chain.next.length > 0) {
        view.nextPeriods = chain.next.map((n) => ({
          id: n.id,
          startAt: n.startAt.toISOString(),
          endAt: n.endAt.toISOString(),
          includedCuts: r.membership.includedCuts,
        }));
        // El método que se muestra es el del ÚLTIMO periodo pagado (la renovación puede ser en otro método).
        const lastPaid = chain.next[chain.next.length - 1]?.paymentMethod;
        if (lastPaid) view.paymentMethod = lastPaid as BarberPaymentMethod;
        // Ya pagó lo que sigue: no está «por vencer».
        view.urgency = membershipUrgency(
          { status: r.status as BarberClientMembershipStatus, endAt: chain.lastEnd, cutsUsed: r.cutsUsed, includedCuts: r.membership.includedCuts },
          now,
        );
      }
      out.push(view);
      continue;
    }
    if ((filter === "active" || filter === "soon") && !chain) continue;
    // Cadena ya no viva (cancelada/vencida): el periodo que empieza justo cuando termina otro de la
    // misma membresía es una renovación, no una membresía aparte.
    if (!chain && rows.some((o) => o.id !== r.id && chainKey(o) === chainKey(r) && o.status === r.status && Math.abs(o.endAt.getTime() - r.startAt.getTime()) < 60_000)) continue;
    out.push(toClientMembershipView(r, now));
  }
  return out;
}

export interface MembershipStats {
  activeCount: number;
  soonCount: number;
  expiredCount: number;
  /** Ingreso recurrente comprometido: suma del precio de las vigentes (una vez por membresía, no por periodo). */
  committedRevenue: number;
}

export async function getMembershipStats(barbershopId: string): Promise<MembershipStats> {
  const shopId = requireShop(barbershopId);
  const now = new Date();

  const [active, expired] = await Promise.all([
    prisma.barberClientMembership.findMany({
      where: { barbershopId: shopId, status: "ACTIVE", endAt: { gt: now } },
      select: {
        id: true,
        clientId: true,
        membershipId: true,
        status: true,
        startAt: true,
        endAt: true,
        cutsUsed: true,
        membership: { select: { price: true } },
      },
    }),
    prisma.barberClientMembership.findMany({
      where: {
        barbershopId: shopId,
        OR: [{ status: "EXPIRED" }, { status: "ACTIVE", endAt: { lte: now } }],
      },
      select: { clientId: true, membershipId: true },
      take: 5000,
    }),
  ]);

  // Una membresía = una cadena (cliente + plan), tenga los periodos que tenga.
  const chains = buildChains(active, now);
  const priceById = new Map(active.map((a) => [a.id, a.membership.price.toString()]));
  const soonLimit = addDays(now, 7).getTime();
  let soonCount = 0;
  let committedCents = 0;
  for (const chain of chains.values()) {
    if (chain.lastEnd.getTime() <= soonLimit) soonCount++;
    committedCents += moneyToCents(priceById.get(chain.current.id) ?? "0");
  }
  const expiredCount = expired.filter((e) => !chains.has(chainKey(e))).length;

  return {
    activeCount: chains.size,
    soonCount,
    expiredCount,
    committedRevenue: committedCents / 100,
  };
}

/** Mensaje único de «sin turno no se registra dinero» para las membresías. */
export const MEMBERSHIP_NEEDS_SESSION_MESSAGE =
  "Abre un turno en Caja antes de registrar el cobro de la membresía: así entra al corte con su método de pago.";

/** La caja habla con BarberCajaError; las APIs de esta ola, con el nuestro. */
function asMembershipError(err: unknown): unknown {
  if (err instanceof BarberCajaError) return new BarberMembershipError(err.code, err.message, err.status);
  return err;
}

/** Lo que devuelve una venta o renovación manual: la membresía + su ticket. */
export type MembershipSaleResult = BarberClientMembershipView & {
  /** Ticket del turno en el que quedó el dinero. */
  saleId: string;
};

/**
 * Vende una membresía cobrada A MANO (efectivo, SPEI o tarjeta en el
 * datáfono). Aquí está el hueco del mercado: no hace falta Stripe para tener
 * membresías — la barbería registra el pago y el sistema calcula la vigencia
 * y avisa cuándo toca renovar.
 *
 * EL DINERO PASA POR LA CAJA: exige un turno abierto y, en la MISMA
 * transacción que crea la membresía, crea un ticket «Venta de membresía · …»
 * por el precio del plan con su método de pago. Así aparece en el corte, en
 * Inicio y en Reportes. Sin turno no se vende (409 NO_OPEN_SESSION) y no
 * queda nada a medias. El ticket NO lleva barbero: la venta de una membresía
 * no genera comisión. Cancelar ese ticket en Caja cancela la membresía.
 *
 * Para el cobro recurrente con tarjeta ver `payments.ts`
 * (createMembershipCheckoutSession) — ese camino crea la fila desde el pago.
 */
export async function sellMembership(args: {
  barbershopId: string;
  clientId: string;
  membershipId: string;
  paymentMethod: BarberPaymentMethod;
  /** Quién cobra (BarberUser.id): es el «cobró» del ticket. */
  soldByUserId: string;
  startAt?: Date;
  now?: Date;
}): Promise<MembershipSaleResult> {
  const shopId = requireShop(args.barbershopId);
  const now = args.now ?? new Date();

  if (args.paymentMethod === "STRIPE") {
    throw new BarberMembershipError(
      "STRIPE_NOT_MANUAL",
      "El cobro recurrente con tarjeta se genera desde el pago en línea, no a mano.",
    );
  }
  if (!args.soldByUserId || typeof args.soldByUserId !== "string") {
    throw new BarberMembershipError("NO_USER", "Falta quién registra la venta.", 401);
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        // Dos clics a la vez sobre el mismo cliente se ponen en fila: el
        // segundo ya ve la membresía del primero y no cobra dos veces.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dcb:memsell:${shopId}:${args.clientId}`}))`;

        const [client, plan, current] = await Promise.all([
          tx.barberClient.findFirst({
            where: { id: args.clientId, barbershopId: shopId },
            select: { id: true },
          }),
          tx.barberMembership.findFirst({
            where: { id: args.membershipId, barbershopId: shopId },
            select: { id: true, name: true, price: true, isActive: true, periodDays: true },
          }),
          tx.barberClientMembership.findFirst({
            where: {
              barbershopId: shopId,
              clientId: args.clientId,
              status: "ACTIVE",
              endAt: { gt: now },
            },
            select: { id: true },
          }),
        ]);

        if (!client) throw new BarberMembershipError("CLIENT_NOT_FOUND", "No encontramos a ese cliente.", 404);
        if (!plan) throw new BarberMembershipError("PLAN_NOT_FOUND", "No encontramos esa membresía.", 404);
        if (!plan.isActive) {
          throw new BarberMembershipError("PLAN_INACTIVE", "Esa membresía está desactivada.");
        }
        if (current) {
          throw new BarberMembershipError(
            "ALREADY_ACTIVE",
            "Este cliente ya tiene una membresía vigente. Renuévala en vez de venderle otra.",
            409,
          );
        }

        const startAt = args.startAt ?? now;
        const endAt = computePeriodEnd(startAt, plan.periodDays);
        const created = await tx.barberClientMembership.create({
          data: {
            barbershopId: shopId,
            clientId: args.clientId,
            membershipId: args.membershipId,
            status: "ACTIVE",
            startAt,
            endAt,
            cutsUsed: 0,
            paymentMethod: args.paymentMethod,
          },
          include: CLIENT_MEMBERSHIP_INCLUDE,
        });

        const ticket = await createCounterTicketTx(tx, {
          barbershopId: shopId,
          soldByUserId: args.soldByUserId,
          clientId: args.clientId,
          description: membershipSaleLineDescription(plan.name),
          amount: plan.price,
          paymentMethod: args.paymentMethod,
          tag: { k: "membership", op: "sell", cm: created.id, end: endAt.toISOString() },
          now,
          noSessionMessage: MEMBERSHIP_NEEDS_SESSION_MESSAGE,
        });

        return { ...toClientMembershipView(created, now), saleId: ticket.id };
      },
      { maxWait: 5000, timeout: 15000 },
    );
  } catch (err) {
    throw asMembershipError(err);
  }
}

/**
 * Renovación MANUAL (efectivo / SPEI / tarjeta en mostrador).
 *  · Si todavía está vigente (D1, 15-nov): AGREGA un periodo nuevo —fila
 *    propia— que empieza cuando termina el último pagado, con su propio cupo.
 *    El periodo vigente conserva sus cortes; los del nuevo no se adelantan.
 *    Cancelar ese ticket cancela solo ese periodo (si no se usó).
 *  · Si ya venció: la misma fila arranca hoy con el cupo en cero.
 *
 * Igual que la venta: exige turno abierto y deja un ticket «Renovación de
 * membresía · …» por el precio ACTUAL del plan. El ticket guarda cómo estaba
 * la membresía antes de renovar; cancelarlo en Caja la deja exactamente así.
 */
export async function renewClientMembership(args: {
  barbershopId: string;
  clientMembershipId: string;
  /** CASH | SPEI | CARD: cómo pagó la renovación. */
  paymentMethod: BarberPaymentMethod;
  soldByUserId: string;
  now?: Date;
}): Promise<MembershipSaleResult> {
  const shopId = requireShop(args.barbershopId);
  const now = args.now ?? new Date();

  if (!args.paymentMethod || args.paymentMethod === "STRIPE") {
    throw new BarberMembershipError(
      "PAYMENT_METHOD_REQUIRED",
      "Elige cómo pagó la renovación: efectivo, transferencia o tarjeta en mostrador.",
    );
  }
  if (!args.soldByUserId || typeof args.soldByUserId !== "string") {
    throw new BarberMembershipError("NO_USER", "Falta quién registra la renovación.", 401);
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        // Candado de fila: dos renovaciones a la vez no encadenan dos periodos
        // con un solo cobro a la vista.
        await tx.$queryRaw`
          SELECT "id" FROM "barber_client_memberships"
          WHERE "id" = ${args.clientMembershipId} AND "barbershopId" = ${shopId}
          FOR UPDATE
        `;
        const row = await tx.barberClientMembership.findFirst({
          where: { id: args.clientMembershipId, barbershopId: shopId },
          include: CLIENT_MEMBERSHIP_INCLUDE,
        });
        if (!row) throw new BarberMembershipError("NOT_FOUND", "No encontramos esa membresía.", 404);
        if (row.stripeSubscriptionId) {
          throw new BarberMembershipError(
            "AUTO_RENEW",
            "Esta membresía se cobra sola con tarjeta. No hace falta renovarla a mano.",
            409,
          );
        }

        // Mismo candado que la venta: dos renovaciones a la vez del mismo
        // cliente se ponen en fila y la segunda ve el periodo de la primera.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dcb:memsell:${shopId}:${row.clientId}`}))`;

        // ── D1 (15-nov): ¿sigue vigente la cadena? Entonces se AGREGA un
        //    periodo nuevo después del último pagado, con su propio cupo. El
        //    periodo vigente no se toca: sus cortes siguen siendo suyos.
        const chain = await tx.barberClientMembership.findMany({
          where: {
            barbershopId: shopId,
            clientId: row.clientId,
            membershipId: row.membershipId,
            status: { in: ["ACTIVE", "PAUSED"] },
            endAt: { gt: now },
          },
          select: { id: true, endAt: true },
          orderBy: { endAt: "desc" },
        });
        if (chain.length > 0) {
          const last = chain[0];
          const startAt = last.endAt;
          const endAt = computePeriodEnd(startAt, row.membership.periodDays);
          const created = await tx.barberClientMembership.create({
            data: {
              barbershopId: shopId,
              clientId: row.clientId,
              membershipId: row.membershipId,
              status: "ACTIVE",
              startAt,
              endAt,
              cutsUsed: 0,
              paymentMethod: args.paymentMethod,
            },
            include: CLIENT_MEMBERSHIP_INCLUDE,
          });
          const ticket = await createCounterTicketTx(tx, {
            barbershopId: shopId,
            soldByUserId: args.soldByUserId,
            clientId: row.clientId,
            description: membershipSaleLineDescription(row.membership.name, true),
            amount: row.membership.price,
            paymentMethod: args.paymentMethod,
            tag: { k: "membership", op: "extend", cm: created.id, end: endAt.toISOString() },
            now,
            noSessionMessage: MEMBERSHIP_NEEDS_SESSION_MESSAGE,
          });
          return { ...toClientMembershipView(created, now), saleId: ticket.id };
        }

        // Ya vencida: no hay periodo vigente que cuidar; la misma fila vuelve a
        // empezar hoy (como siempre), y cancelar el ticket la deja como estaba.
        const startAt = row.endAt.getTime() > now.getTime() ? row.endAt : now;
        const endAt = nextPeriodEnd(row.endAt, row.membership.periodDays, now);

        const updated = await tx.barberClientMembership.update({
          where: { id: row.id },
          data: {
            status: "ACTIVE",
            startAt,
            endAt,
            cutsUsed: 0,
            paymentMethod: args.paymentMethod,
          },
          include: CLIENT_MEMBERSHIP_INCLUDE,
        });

        const ticket = await createCounterTicketTx(tx, {
          barbershopId: shopId,
          soldByUserId: args.soldByUserId,
          clientId: row.clientId,
          description: membershipSaleLineDescription(row.membership.name, true),
          amount: row.membership.price,
          paymentMethod: args.paymentMethod,
          tag: {
            k: "membership",
            op: "renew",
            cm: row.id,
            end: endAt.toISOString(),
            prev: {
              start: row.startAt.toISOString(),
              end: row.endAt.toISOString(),
              cuts: row.cutsUsed,
              status: row.status,
              method: row.paymentMethod,
            },
          },
          now,
          noSessionMessage: MEMBERSHIP_NEEDS_SESSION_MESSAGE,
        });

        return { ...toClientMembershipView(updated, now), saleId: ticket.id };
      },
      { maxWait: 5000, timeout: 15000 },
    );
  } catch (err) {
    throw asMembershipError(err);
  }
}

export async function setClientMembershipStatus(args: {
  barbershopId: string;
  clientMembershipId: string;
  status: Extract<BarberClientMembershipStatus, "ACTIVE" | "PAUSED" | "CANCELLED">;
}): Promise<void> {
  const shopId = requireShop(args.barbershopId);
  const row = await prisma.barberClientMembership.findFirst({
    where: { id: args.clientMembershipId, barbershopId: shopId },
    select: { id: true, clientId: true, membershipId: true },
  });
  if (!row) {
    throw new BarberMembershipError("NOT_FOUND", "No encontramos esa membresía.", 404);
  }
  // Pausar, reactivar o cancelar va con la membresía ENTERA: el periodo
  // vigente y los próximos ya pagados de la misma cadena (D1). Las vencidas
  // y canceladas no se tocan.
  await prisma.barberClientMembership.updateMany({
    where: {
      barbershopId: shopId,
      OR: [
        { id: row.id },
        {
          clientId: row.clientId,
          membershipId: row.membershipId,
          status: { in: ["ACTIVE", "PAUSED"] },
          endAt: { gt: new Date() },
        },
      ],
    },
    data: { status: args.status },
  });
}

// ═══════════════════════════════════════════════════════════════════════
// C. Consumo — la parte que llama T3 al cerrar la visita
// ═══════════════════════════════════════════════════════════════════════

/**
 * ═══ EL CANDADO DEL CUPO — úsalo desde CUALQUIER transacción ═══
 *
 * Descuenta UN corte de forma atómica. Todo el candado (barbería + vigencia
 * + cupo) va DENTRO del WHERE de un solo UPDATE, así que Postgres re-evalúa
 * la condición contra la fila ya actualizada cuando dos cierres llegan a la
 * vez: el segundo no encuentra fila y devuelve false. El cupo NUNCA queda
 * por encima de includedCuts.
 *
 * Acepta el cliente de Prisma o el `tx` de una transacción ajena, para que
 * el cierre del ticket (T3) pueda usarlo dentro de la suya:
 *
 *   const ok = await consumeMembershipCutTx(tx, {
 *     barbershopId,
 *     clientMembershipId: lookup.activeMembership.id,
 *     includedCuts: lookup.activeMembership.includedCuts,
 *   });
 *   if (!ok) throw new Error("La membresía ya no tiene cupo");
 *
 * ⚠️ Un increment SIN el cupo en el WHERE (leer el cupo en JS y luego
 * escribir) deja pasar dos cierres simultáneos y se pasa del cupo: es
 * exactamente el caso que reproduce el CONTROL de concurrencia.test.ts.
 */
export async function consumeMembershipCutTx(
  db: {
    barberClientMembership: {
      updateMany(args: { where: unknown; data: unknown }): Promise<{ count: number }>;
    };
  },
  args: {
    barbershopId: string;
    clientMembershipId: string;
    /** null = ilimitada (se omite la condición de cupo a propósito). */
    includedCuts: number | null;
    now?: Date;
  },
): Promise<boolean> {
  const shopId = requireShop(args.barbershopId);
  const where = buildConsumeWhere({
    clientMembershipId: args.clientMembershipId,
    barbershopId: shopId,
    includedCuts: args.includedCuts,
    now: args.now ?? new Date(),
  });
  const res = await db.barberClientMembership.updateMany({
    where: where as Prisma.BarberClientMembershipWhereInput,
    data: { cutsUsed: { increment: 1 } },
  });
  return res.count === 1;
}

/**
 * El periodo VIGENTE de la membresía del cliente (o null). Decide el
 * servidor, siempre. Con renovaciones anticipadas hay varias filas activas:
 * la vigente es la que ya empezó (pickCurrentPeriod, D1); las demás son
 * «próximos periodos» y no se gastan antes de tiempo.
 */
export async function getActiveClientMembership(barbershopId: string, clientId: string, now: Date = new Date()) {
  const shopId = requireShop(barbershopId);
  const rows = await prisma.barberClientMembership.findMany({
    where: { barbershopId: shopId, clientId, status: { in: ["ACTIVE", "PAUSED", "EXPIRED"] }, endAt: { gt: addDays(now, -400) } },
    include: CLIENT_MEMBERSHIP_INCLUDE,
    orderBy: { startAt: "asc" },
    take: 50,
  });
  return pickCurrentPeriod(rows, now);
}

function emptyCoverage(reason: MembershipCoverageResult["reason"]): MembershipCoverageResult {
  return {
    covered: false,
    reason,
    clientMembershipId: null,
    membershipName: null,
    coveredLineIndex: -1,
    discountCents: 0,
    cutsUsed: 0,
    includedCuts: null,
    remaining: null,
    creditLine: null,
  };
}

/**
 * ¿Qué pasaría si cerramos esta visita? SOLO LECTURA — no descuenta nada.
 * Sirve para pintar "Cubierto por membresía" en el ticket antes de cobrar y
 * para avisar "ya se le acabaron los cortes" sin efectos secundarios.
 */
export async function previewMembershipCoverage(args: {
  barbershopId: string;
  clientId: string | null;
  lines: MembershipCoverageLine[];
}): Promise<MembershipCoverageResult> {
  const shopId = requireShop(args.barbershopId);
  if (!args.clientId) return emptyCoverage("NO_CLIENT");

  const row = await getActiveClientMembership(shopId, args.clientId);
  const now = new Date();

  if (!row) {
    // Puede que tenga una vencida: distinguirlo mejora el mensaje en pantalla.
    const stale = await prisma.barberClientMembership.findFirst({
      where: { barbershopId: shopId, clientId: args.clientId },
      orderBy: { endAt: "desc" },
      select: { id: true },
    });
    return emptyCoverage(stale ? "EXPIRED" : "NO_MEMBERSHIP");
  }

  const state = {
    status: row.status as BarberClientMembershipStatus,
    endAt: row.endAt,
    cutsUsed: row.cutsUsed,
    includedCuts: row.membership.includedCuts,
    stripeSubscriptionId: row.stripeSubscriptionId,
  };
  const reason = coverageReason(state, now);
  const base: MembershipCoverageResult = {
    ...emptyCoverage(reason),
    clientMembershipId: row.id,
    membershipName: row.membership.name,
    cutsUsed: row.cutsUsed,
    includedCuts: row.membership.includedCuts,
    remaining: remainingCuts(row.membership.includedCuts, row.cutsUsed),
  };
  if (reason !== "COVERED") return base;

  const idx = pickCoveredLine(args.lines);
  if (idx < 0) return { ...base, reason: "NO_ELIGIBLE_LINE" };

  const line = args.lines[idx];
  return {
    ...base,
    covered: true,
    reason: "COVERED",
    coveredLineIndex: idx,
    discountCents: line.unitPriceCents,
    creditLine: {
      description: membershipLineDescription(row.membership.name, line.description),
      unitPriceCents: -line.unitPriceCents,
      qty: 1,
    },
  };
}

/**
 * ═══ PUNTO DE ENTRADA DE T3 (ticket y caja) ═══
 *
 * Cierra la visita contra la membresía: descuenta UN corte y deja el servicio
 * en $0 mediante una línea de CRÉDITO negativa en el ticket (así la comisión
 * del barbero y el reporte siguen viendo el precio real del servicio).
 *
 * Cómo usarla desde el cierre del ticket:
 *
 *   const cov = await applyMembershipToVisit({
 *     barbershopId: ctx.barbershopId,   // SIEMPRE de getBarberContext()
 *     clientId: sale.clientId,
 *     lines: items.map(i => ({ serviceId: i.serviceId, description: i.description,
 *                              unitPriceCents: moneyToCents(i.unitPrice), qty: i.qty })),
 *     saleId: sale.id,                  // inserta la línea de crédito
 *     appointmentId: sale.appointmentId // hace la operación idempotente
 *   });
 *   cov.covered === true            -> recalcula subtotal/total desde las líneas
 *   cov.reason === "QUOTA_EXHAUSTED" -> avisa en pantalla: el servicio se cobra normal
 *
 *  · `saleId` ausente → NO toca el ticket: solo descuenta el corte y devuelve
 *    la línea sugerida en `creditLine` para que la inserte quien llama.
 *  · `appointmentId` presente → si esa visita YA tiene una línea de membresía,
 *    devuelve reason "ALREADY_APPLIED" y no vuelve a descontar.
 *  · El total del ticket NO se recalcula aquí (es de T3): las líneas son la
 *    fuente, y la de membresía es negativa.
 *  · Si el cupo se agotó devuelve covered:false / "QUOTA_EXHAUSTED" y el
 *    servicio se cobra normal. El cupo NUNCA queda negativo.
 */
export async function applyMembershipToVisit(args: {
  barbershopId: string;
  clientId: string | null;
  lines: MembershipCoverageLine[];
  saleId?: string | null;
  appointmentId?: string | null;
}): Promise<MembershipCoverageResult> {
  const shopId = requireShop(args.barbershopId);
  if (!args.clientId) return emptyCoverage("NO_CLIENT");

  const preview = await previewMembershipCoverage({
    barbershopId: shopId,
    clientId: args.clientId,
    lines: args.lines,
  });
  if (!preview.covered || !preview.clientMembershipId) return preview;

  // Idempotencia por visita: si el ticket de esta cita ya trae la línea de
  // membresía, no se descuenta un segundo corte.
  if (args.appointmentId) {
    const already = await prisma.barberSaleItem.count({
      where: {
        sale: { appointmentId: args.appointmentId, barbershopId: shopId },
        // Las DOS marcas: la línea de crédito de esta ola y el sufijo que le
        // pone la caja al servicio cubierto. Si cualquiera está, no se
        // descuenta un segundo corte por la misma visita.
        OR: [
          { description: { startsWith: BARBER_MEMBERSHIP_LINE_PREFIX } },
          { description: { endsWith: BARBER_CASH_MEMBERSHIP_SUFFIX } },
        ],
      },
    });
    if (already > 0) return { ...preview, covered: false, reason: "ALREADY_APPLIED" };
  }

  // ── El candado: un solo UPDATE con vigencia + cupo DENTRO del WHERE.
  const consumed = await consumeMembershipCutTx(prisma, {
    barbershopId: shopId,
    clientMembershipId: preview.clientMembershipId,
    includedCuts: preview.includedCuts,
  });

  if (!consumed) {
    // Perdió la carrera (o venció entre el preview y el update).
    const fresh = await prisma.barberClientMembership.findFirst({
      where: { id: preview.clientMembershipId, barbershopId: shopId },
      select: { cutsUsed: true, status: true, endAt: true },
    });
    return {
      ...preview,
      covered: false,
      reason:
        fresh && fresh.status === "ACTIVE" && fresh.endAt.getTime() > Date.now()
          ? "QUOTA_EXHAUSTED"
          : "EXPIRED",
      cutsUsed: fresh?.cutsUsed ?? preview.cutsUsed,
      remaining: remainingCuts(preview.includedCuts, fresh?.cutsUsed ?? preview.cutsUsed),
      coveredLineIndex: -1,
      discountCents: 0,
      creditLine: null,
    };
  }

  const cutsUsed = preview.cutsUsed + 1;
  const result: MembershipCoverageResult = {
    ...preview,
    cutsUsed,
    remaining: remainingCuts(preview.includedCuts, cutsUsed),
  };

  if (!args.saleId || !result.creditLine) return result;

  // Inserta la línea de crédito en el ticket que nos indicaron. Si el ticket
  // no es de esta barbería, se revierte el corte para no cobrarlo de gratis.
  const sale = await prisma.barberSale.findFirst({
    where: { id: args.saleId, barbershopId: shopId },
    select: { id: true },
  });
  if (!sale) {
    await releaseMembershipCut({
      barbershopId: shopId,
      clientMembershipId: preview.clientMembershipId,
    });
    throw new BarberMembershipError("SALE_NOT_FOUND", "No encontramos ese ticket.", 404);
  }

  await prisma.barberSaleItem.create({
    data: {
      saleId: sale.id,
      serviceId: args.lines[result.coveredLineIndex]?.serviceId ?? null,
      productId: null,
      description: result.creditLine.description,
      qty: 1,
      unitPrice: new Prisma.Decimal(centsToMoney(result.creditLine.unitPriceCents)),
    },
  });

  return result;
}

/**
 * Compensación: devuelve un corte al cupo (por ejemplo si el ticket se
 * canceló). Nunca baja de cero.
 */
export async function releaseMembershipCut(args: {
  barbershopId: string;
  clientMembershipId: string;
}): Promise<void> {
  const shopId = requireShop(args.barbershopId);
  await prisma.barberClientMembership.updateMany({
    where: { id: args.clientMembershipId, barbershopId: shopId, cutsUsed: { gt: 0 } },
    data: { cutsUsed: { decrement: 1 } },
  });
}

// ═══════════════════════════════════════════════════════════════════════
// D. Lecturas para T5 (portal del cliente final)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ═══ PARA T5 (portal del cliente) ═══
 * La membresía vigente del cliente, lista para pintar: nombre del plan,
 * cortes usados vs incluidos, cuántos le quedan, hasta cuándo y si se
 * renueva sola. Devuelve null si no tiene ninguna vigente.
 */
export async function getClientMembershipForPortal(args: {
  barbershopId: string;
  clientId: string;
}): Promise<BarberClientMembershipView | null> {
  const shopId = requireShop(args.barbershopId);
  await sweepExpiredMemberships(shopId);
  const row = await getActiveClientMembership(shopId, args.clientId);
  return row ? toClientMembershipView(row, new Date()) : null;
}

/**
 * ═══ PARA T5 (portal del cliente) ═══
 * Historial completo de membresías del cliente, de la más reciente a la más
 * vieja (incluye vencidas y canceladas).
 */
export async function listClientMembershipHistory(args: {
  barbershopId: string;
  clientId: string;
  take?: number;
}): Promise<BarberClientMembershipView[]> {
  const shopId = requireShop(args.barbershopId);
  const now = new Date();
  const rows = await prisma.barberClientMembership.findMany({
    where: { barbershopId: shopId, clientId: args.clientId },
    include: CLIENT_MEMBERSHIP_INCLUDE,
    orderBy: { startAt: "desc" },
    take: Math.min(100, Math.max(1, args.take ?? 20)),
  });
  return rows.map((r) => toClientMembershipView(r, now));
}

/**
 * ═══ PARA T5 (reserva pública / portal) ═══
 * Catálogo público de membresías activas de la barbería, para mostrarlas y
 * venderlas en línea. No expone nada interno.
 */
export async function listPublicMembershipPlans(barbershopId: string) {
  const shopId = requireShop(barbershopId);
  const plans = await prisma.barberMembership.findMany({
    where: { barbershopId: shopId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      includedCuts: true,
      periodDays: true,
    },
  });
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: toNumber(p.price),
    includedCuts: p.includedCuts,
    periodDays: p.periodDays,
  }));
}

// ── Re-export del núcleo puro: las otras terminales importan SOLO de aquí. ──
export * from "@/lib/barber/memberships-core";
