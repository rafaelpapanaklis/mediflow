import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  BarberClientMembershipStatus,
  BarberPaymentMethod,
} from "@/lib/barber/types";
import {
  BARBER_MEMBERSHIP_STRIPE_GRACE_DAYS,
  addDays,
  buildConsumeWhere,
  centsToMoney,
  computePeriodEnd,
  coverageReason,
  daysUntil,
  membershipLineDescription,
  membershipUrgency,
  moneyToCents,
  nextPeriodEnd,
  pickCoveredLine,
  remainingCuts,
  BARBER_MEMBERSHIP_LINE_PREFIX,
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

  const where: Prisma.BarberClientMembershipWhereInput = { barbershopId: shopId };

  if (filter === "active") {
    where.status = "ACTIVE";
    where.endAt = { gt: addDays(now, 7) };
  } else if (filter === "soon") {
    where.status = "ACTIVE";
    where.endAt = { gt: now, lte: addDays(now, 7) };
  } else if (filter === "expired") {
    where.OR = [{ status: "EXPIRED" }, { status: "ACTIVE", endAt: { lte: now } }];
  }

  if (q) {
    const search: Prisma.BarberClientMembershipWhereInput = {
      client: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { phone: { contains: q.replace(/\D/g, "") || q } },
        ],
      },
    };
    where.AND = [search];
  }

  const rows = await prisma.barberClientMembership.findMany({
    where,
    include: CLIENT_MEMBERSHIP_INCLUDE,
    orderBy: [{ endAt: "asc" }],
    take: Math.min(500, Math.max(1, opts.take ?? 200)),
  });

  return rows.map((r) => toClientMembershipView(r, now));
}

export interface MembershipStats {
  activeCount: number;
  soonCount: number;
  expiredCount: number;
  /** Ingreso recurrente comprometido: suma del precio de las vigentes. */
  committedRevenue: number;
}

export async function getMembershipStats(barbershopId: string): Promise<MembershipStats> {
  const shopId = requireShop(barbershopId);
  const now = new Date();

  const active = await prisma.barberClientMembership.findMany({
    where: { barbershopId: shopId, status: "ACTIVE", endAt: { gt: now } },
    select: { endAt: true, membership: { select: { price: true } } },
  });

  const soonLimit = addDays(now, 7).getTime();
  let soonCount = 0;
  let committedCents = 0;
  for (const m of active) {
    if (m.endAt.getTime() <= soonLimit) soonCount++;
    committedCents += moneyToCents(m.membership.price.toString());
  }

  const expiredCount = await prisma.barberClientMembership.count({
    where: {
      barbershopId: shopId,
      OR: [{ status: "EXPIRED" }, { status: "ACTIVE", endAt: { lte: now } }],
    },
  });

  return {
    activeCount: active.length,
    soonCount,
    expiredCount,
    committedRevenue: committedCents / 100,
  };
}

/**
 * Vende una membresía cobrada A MANO (efectivo, SPEI o tarjeta en el
 * datáfono). Aquí está el hueco del mercado: no hace falta Stripe para tener
 * membresías — la barbería registra el pago y el sistema calcula la vigencia
 * y avisa cuándo toca renovar.
 *
 * Para el cobro recurrente con tarjeta ver `payments.ts`
 * (createMembershipCheckoutSession) — ese camino crea la fila desde el pago.
 */
export async function sellMembership(args: {
  barbershopId: string;
  clientId: string;
  membershipId: string;
  paymentMethod: BarberPaymentMethod;
  startAt?: Date;
}): Promise<BarberClientMembershipView> {
  const shopId = requireShop(args.barbershopId);
  const now = new Date();

  if (args.paymentMethod === "STRIPE") {
    throw new BarberMembershipError(
      "STRIPE_NOT_MANUAL",
      "El cobro recurrente con tarjeta se genera desde el pago en línea, no a mano.",
    );
  }

  const [client, plan, current] = await Promise.all([
    prisma.barberClient.findFirst({
      where: { id: args.clientId, barbershopId: shopId },
      select: { id: true },
    }),
    prisma.barberMembership.findFirst({
      where: { id: args.membershipId, barbershopId: shopId },
      select: { id: true, isActive: true, periodDays: true },
    }),
    prisma.barberClientMembership.findFirst({
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
  const created = await prisma.barberClientMembership.create({
    data: {
      barbershopId: shopId,
      clientId: args.clientId,
      membershipId: args.membershipId,
      status: "ACTIVE",
      startAt,
      endAt: computePeriodEnd(startAt, plan.periodDays),
      cutsUsed: 0,
      paymentMethod: args.paymentMethod,
    },
    include: CLIENT_MEMBERSHIP_INCLUDE,
  });

  return toClientMembershipView(created, now);
}

/**
 * Renovación MANUAL (efectivo / SPEI / tarjeta en mostrador): extiende el
 * periodo y pone el contador de cortes en cero. Si todavía está vigente, el
 * periodo nuevo se encadena al final del actual (el cliente no pierde días).
 */
export async function renewClientMembership(args: {
  barbershopId: string;
  clientMembershipId: string;
  paymentMethod?: BarberPaymentMethod;
}): Promise<BarberClientMembershipView> {
  const shopId = requireShop(args.barbershopId);
  const now = new Date();

  const row = await prisma.barberClientMembership.findFirst({
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

  const startAt = row.endAt.getTime() > now.getTime() ? row.endAt : now;
  const endAt = nextPeriodEnd(row.endAt, row.membership.periodDays, now);

  const updated = await prisma.barberClientMembership.update({
    where: { id: row.id },
    data: {
      status: "ACTIVE",
      startAt,
      endAt,
      cutsUsed: 0,
      ...(args.paymentMethod && args.paymentMethod !== "STRIPE"
        ? { paymentMethod: args.paymentMethod }
        : {}),
    },
    include: CLIENT_MEMBERSHIP_INCLUDE,
  });

  return toClientMembershipView(updated, now);
}

export async function setClientMembershipStatus(args: {
  barbershopId: string;
  clientMembershipId: string;
  status: Extract<BarberClientMembershipStatus, "ACTIVE" | "PAUSED" | "CANCELLED">;
}): Promise<void> {
  const shopId = requireShop(args.barbershopId);
  const res = await prisma.barberClientMembership.updateMany({
    where: { id: args.clientMembershipId, barbershopId: shopId },
    data: { status: args.status },
  });
  if (res.count === 0) {
    throw new BarberMembershipError("NOT_FOUND", "No encontramos esa membresía.", 404);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// C. Consumo — la parte que llama T3 al cerrar la visita
// ═══════════════════════════════════════════════════════════════════════

/** La membresía vigente del cliente (o null). Decide el servidor, siempre. */
export async function getActiveClientMembership(barbershopId: string, clientId: string) {
  const shopId = requireShop(barbershopId);
  return prisma.barberClientMembership.findFirst({
    where: { barbershopId: shopId, clientId, status: "ACTIVE", endAt: { gt: new Date() } },
    include: CLIENT_MEMBERSHIP_INCLUDE,
    orderBy: { endAt: "desc" },
  });
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
        description: { startsWith: BARBER_MEMBERSHIP_LINE_PREFIX },
      },
    });
    if (already > 0) return { ...preview, covered: false, reason: "ALREADY_APPLIED" };
  }

  // ── El candado: un solo UPDATE con vigencia + cupo DENTRO del WHERE.
  //    Dos peticiones simultáneas → Postgres re-evalúa la condición sobre la
  //    fila ya actualizada y la segunda no encuentra fila (count 0).
  const where = buildConsumeWhere({
    clientMembershipId: preview.clientMembershipId,
    barbershopId: shopId,
    includedCuts: preview.includedCuts,
    now: new Date(),
  });

  const res = await prisma.barberClientMembership.updateMany({
    where: where as Prisma.BarberClientMembershipWhereInput,
    data: { cutsUsed: { increment: 1 } },
  });

  if (res.count === 0) {
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
