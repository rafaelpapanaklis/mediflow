import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  assertRealtyPermission,
  getAccessibleOfficeIds,
  hasRealtyPermission,
  type RealtyContext,
} from "@/lib/realty-auth";
import { assertRealtyArea, RealtyAdminError } from "@/lib/realty/team";
import {
  buildRanking,
  buildReceipt,
  computeSplits,
  currentPeriodKey,
  inferTemplates,
  isValidPeriodKey,
  periodRange,
  REALTY_DEFAULT_TZ,
  toCents,
  type RealtyAgentPerf,
  type RealtyAgentPerfInput,
  type RealtyReceipt,
  type RealtyReceiptSplitRow,
  type RealtySplitInput,
  type RealtySplitTemplate,
} from "@/lib/realty/commissions";
import {
  REALTY_COMMISSION_PARTY_LABELS,
  type RealtyCommissionParty,
  type RealtyDealKind,
  type RealtyDealStatus,
} from "@/lib/realty/types";

// ═══════════════════════════════════════════════════════════════════════
// OPERACIONES CERRADAS (RealtyDeal) y su REPARTO (RealtyCommissionSplit).
//
// Vive junto a la API y no en src/lib/realty/commissions.ts a propósito: ese
// módulo es PURO y client-safe (el editor de reparto lo importa para enseñar
// los pesos mientras se escribe). Aquí está lo que toca la base.
//
// ALCANCE por rol — el permiso da la puerta, no el alcance:
//  · commissions.manage → ve TODAS las operaciones de la cuenta.
//  · solo commissions.view (el asesor) → ve las operaciones DONDE TIENE
//    PARTE. Ese recorte es del SERVIDOR; la UI solo pinta lo que llega.
// Y encima, siempre, el recorte por oficina de getAccessibleOfficeIds.
//
// 🔴 Un inmueble puede tener officeId NULL (cartera sin oficina). Un
// `{ in: [...] }` a secas los DESCARTA, así que el where va con el OR que
// documenta getAccessibleOfficeIds, SIEMPRE junto al accountId.
// ═══════════════════════════════════════════════════════════════════════

const DEAL_SELECT = {
  id: true,
  accountId: true,
  propertyId: true,
  kind: true,
  contactId: true,
  closedAt: true,
  amount: true,
  commissionAmount: true,
  status: true,
  notes: true,
  createdAt: true,
  property: {
    select: { id: true, title: true, officeId: true, status: true, operation: true },
  },
  contact: { select: { id: true, name: true } },
  splits: {
    select: {
      id: true,
      realtyUserId: true,
      party: true,
      pct: true,
      amount: true,
      externalName: true,
      paidAt: true,
      realtyUser: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.RealtyDealSelect;

type DealRaw = Prisma.RealtyDealGetPayload<{ select: typeof DEAL_SELECT }>;

export interface RealtySplitRow {
  id: string;
  realtyUserId: string | null;
  realtyUserName: string | null;
  externalName: string | null;
  /** Nombre que se pinta: la persona, el externo, o "La oficina". */
  beneficiary: string;
  party: RealtyCommissionParty;
  pct: number;
  amount: number;
  paidAt: string | null;
}

export interface RealtyDealRow {
  id: string;
  propertyId: string;
  propertyTitle: string;
  officeId: string | null;
  kind: RealtyDealKind;
  contactId: string | null;
  contactName: string | null;
  closedAt: string | null;
  amount: number;
  commissionAmount: number;
  /** commissionAmount / amount × 100 — el porcentaje real que se cobró. */
  commissionPct: number | null;
  status: RealtyDealStatus;
  notes: string | null;
  createdAt: string;
  splits: RealtySplitRow[];
  /** Suma de las partes. Si no cuadra con commissionAmount, la UI lo grita. */
  assigned: number;
  balanced: boolean;
  paid: number;
  pending: number;
}

function beneficiaryName(s: DealRaw["splits"][number]): string {
  if (s.realtyUser) return `${s.realtyUser.firstName} ${s.realtyUser.lastName}`.trim();
  if (s.externalName) return s.externalName;
  return REALTY_COMMISSION_PARTY_LABELS[s.party];
}

function toDealRow(d: DealRaw): RealtyDealRow {
  const commissionCents = toCents(d.commissionAmount);
  const amountCents = toCents(d.amount);
  let assignedCents = 0;
  let paidCents = 0;

  const splits: RealtySplitRow[] = d.splits.map((s) => {
    const cents = toCents(s.amount);
    assignedCents += cents;
    if (s.paidAt) paidCents += cents;
    return {
      id: s.id,
      realtyUserId: s.realtyUserId,
      realtyUserName: s.realtyUser
        ? `${s.realtyUser.firstName} ${s.realtyUser.lastName}`.trim()
        : null,
      externalName: s.externalName,
      beneficiary: beneficiaryName(s),
      party: s.party,
      pct: Number(s.pct),
      amount: Number(s.amount),
      paidAt: s.paidAt ? s.paidAt.toISOString() : null,
    };
  });

  return {
    id: d.id,
    propertyId: d.propertyId,
    propertyTitle: d.property?.title ?? "Inmueble",
    officeId: d.property?.officeId ?? null,
    kind: d.kind,
    contactId: d.contactId,
    contactName: d.contact?.name ?? null,
    closedAt: d.closedAt ? d.closedAt.toISOString() : null,
    amount: Number(d.amount),
    commissionAmount: Number(d.commissionAmount),
    commissionPct:
      amountCents > 0 ? Math.round((commissionCents / amountCents) * 10000) / 100 : null,
    status: d.status,
    notes: d.notes,
    createdAt: d.createdAt.toISOString(),
    splits,
    assigned: assignedCents / 100,
    balanced: assignedCents === commissionCents,
    paid: paidCents / 100,
    pending: (assignedCents - paidCents) / 100,
  };
}

/** ¿Puede repartir y marcar pagado, o solo mirar lo suyo? */
function canManage(ctx: RealtyContext): boolean {
  return hasRealtyPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "commissions.manage",
  );
}

/** El where base: cuenta + oficina + (si no administra) solo lo suyo. */
async function dealScopeWhere(ctx: RealtyContext): Promise<Prisma.RealtyDealWhereInput> {
  const officeIds = await getAccessibleOfficeIds(ctx);
  const where: Prisma.RealtyDealWhereInput = {
    accountId: ctx.accountId,
    // Los inmuebles SIN oficina también son de la cuenta: dejarlos fuera
    // haría desaparecer operaciones reales de la pantalla.
    property: { OR: [{ officeId: { in: officeIds } }, { officeId: null }] },
  };
  if (!canManage(ctx)) {
    where.splits = { some: { realtyUserId: ctx.realtyUserId } };
  }
  return where;
}

/**
 * 🔴 El MISMO recorte de oficina para ESCRIBIR.
 *
 * El filtro de oficina estaba solo en la lectura: un gerente con acceso a la
 * sucursal 1 no VEÍA las operaciones de la 2 en su lista, pero con el id en
 * la mano podía cerrarlas, repartirlas y marcarlas pagadas — y la respuesta
 * le devolvía la operación entera, así que la escritura era además un canal
 * de lectura de lo que el alcance le negaba.
 *
 * Todo lo que toque una operación por id pasa por aquí. `deals.manage` /
 * `commissions.manage` dan la PUERTA; esto da el ALCANCE.
 */
async function loadDealInScope(ctx: RealtyContext, dealId: string) {
  const officeIds = await getAccessibleOfficeIds(ctx);
  const deal = await prisma.realtyDeal.findFirst({
    where: {
      id: dealId,
      accountId: ctx.accountId,
      property: { OR: [{ officeId: { in: officeIds } }, { officeId: null }] },
    },
    select: { id: true },
  });
  if (!deal) throw new RealtyAdminError("Esa operación no es de tu cuenta.", 404, "NOT_FOUND");
  return deal;
}

export function accountTz(ctx: RealtyContext): string {
  return ctx.account.timezone || REALTY_DEFAULT_TZ;
}

// ── Lectura ────────────────────────────────────────────────────────────

export interface DealsScreen {
  periodKey: string;
  timezone: string;
  canManage: boolean;
  canRegister: boolean;
  /** true = el usuario ve solo las operaciones donde tiene parte. */
  selfOnly: boolean;
  deals: RealtyDealRow[];
  receipt: RealtyReceipt;
  ranking: RealtyAgentPerf[];
  templates: RealtySplitTemplate[];
  agents: { id: string; name: string; active: boolean }[];
  properties: { id: string; title: string; operation: string; status: string }[];
  contacts: { id: string; name: string }[];
  totals: {
    closedDeals: number;
    volume: number;
    commission: number;
    paid: number;
    pending: number;
    inProgress: number;
    unbalanced: number;
  };
}

/**
 * Todo lo que necesita /inmobiliaria/comisiones para un periodo. Una sola
 * función para que la página y la API devuelvan EXACTAMENTE lo mismo.
 */
export async function getDealsScreen(
  ctx: RealtyContext,
  requestedPeriod?: string | null,
): Promise<DealsScreen> {
  assertRealtyArea(ctx, "comisiones");
  assertRealtyPermission(ctx, "commissions.view");
  const tz = accountTz(ctx);
  const periodKey = isValidPeriodKey(requestedPeriod) ? requestedPeriod : currentPeriodKey(tz);
  const { start, end } = periodRange(periodKey, tz);
  const scope = await dealScopeWhere(ctx);
  const manage = canManage(ctx);

  const [periodDeals, historySplits, agents, properties, contacts] = await Promise.all([
    prisma.realtyDeal.findMany({
      where: {
        ...scope,
        // Lo CERRADO se ancla a su fecha de cierre; lo que sigue vivo
        // (EN_PROCESO) se ve siempre, aunque se haya capturado hace meses:
        // esconderlo es como si no existiera.
        OR: [{ closedAt: { gte: start, lt: end } }, { status: "EN_PROCESO" }],
      },
      select: DEAL_SELECT,
      orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
    }),
    // Historial COMPLETO para deducir las plantillas de reparto de la cuenta.
    prisma.realtyCommissionSplit.findMany({
      where: { accountId: ctx.accountId },
      select: { dealId: true, party: true, pct: true },
      take: 2000,
      orderBy: { createdAt: "desc" },
    }),
    prisma.realtyUser.findMany({
      where: { accountId: ctx.accountId },
      select: { id: true, firstName: true, lastName: true, active: true },
      orderBy: [{ active: "desc" }, { firstName: "asc" }],
    }),
    manage
      ? prisma.realtyProperty.findMany({
          where: { accountId: ctx.accountId },
          select: { id: true, title: true, operation: true, status: true },
          orderBy: { createdAt: "desc" },
          take: 500,
        })
      : Promise.resolve([]),
    manage
      ? prisma.realtyContact.findMany({
          where: { accountId: ctx.accountId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 500,
        })
      : Promise.resolve([]),
  ]);

  const deals = periodDeals.map(toDealRow);

  // El recibo mira SOLO lo del periodo: una operación EN_PROCESO capturada
  // hace meses no debe inflar "lo que se va a ganar este mes".
  const inPeriod = deals.filter((d) => {
    if (d.status === "CERRADO") return d.closedAt !== null;
    return new Date(d.createdAt) >= start && new Date(d.createdAt) < end;
  });

  const receiptRows: RealtyReceiptSplitRow[] = inPeriod.flatMap((d) =>
    d.splits.map((s) => ({
      splitId: s.id,
      dealId: d.id,
      dealKind: d.kind,
      dealStatus: d.status,
      closedAt: d.closedAt,
      propertyTitle: d.propertyTitle,
      party: s.party,
      realtyUserId: s.realtyUserId,
      beneficiary: s.beneficiary,
      pct: s.pct,
      amount: s.amount,
      paidAt: s.paidAt,
    })),
  );

  const receipt = buildReceipt(start.toISOString(), end.toISOString(), receiptRows);
  const ranking = await buildAgentRanking(ctx, periodKey, agents, inPeriod);
  const templates = inferTemplates(historySplits);

  const closed = inPeriod.filter((d) => d.status === "CERRADO");
  let volumeCents = 0;
  let commissionCents = 0;
  for (const d of closed) {
    volumeCents += toCents(d.amount);
    commissionCents += toCents(d.commissionAmount);
  }

  return {
    periodKey,
    timezone: tz,
    canManage: manage,
    canRegister: hasRealtyPermission(
      { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
      "deals.manage",
    ),
    selfOnly: !manage,
    deals,
    receipt,
    ranking,
    templates,
    agents: agents.map((a) => ({
      id: a.id,
      name: `${a.firstName} ${a.lastName}`.trim(),
      active: a.active,
    })),
    properties,
    contacts,
    totals: {
      closedDeals: closed.length,
      volume: volumeCents / 100,
      commission: commissionCents / 100,
      paid: receipt.totalPaid,
      pending: receipt.totalPending,
      inProgress: receipt.totalInProgress,
      unbalanced: deals.filter((d) => d.status === "CERRADO" && !d.balanced).length,
    },
  };
}

/**
 * Metas y ranking. Los números salen de lo que YA hay: operaciones cerradas,
 * prospectos del periodo y el reloj de la primera respuesta.
 *
 * 🔴 No hay tabla de METAS en el schema y esta ola no lo toca, así que el
 * tablero compara contra la propia cuenta (el mejor del periodo y el
 * promedio del equipo) en vez de contra un número inventado. Cuando exista
 * realty_agent_goals, la meta entra aquí y nada más cambia.
 */
async function buildAgentRanking(
  ctx: RealtyContext,
  periodKey: string,
  agents: { id: string; firstName: string; lastName: string; active: boolean }[],
  periodDeals: RealtyDealRow[],
): Promise<RealtyAgentPerf[]> {
  const tz = accountTz(ctx);
  const { start, end } = periodRange(periodKey, tz);
  const manage = canManage(ctx);

  const leads = await prisma.realtyLead.findMany({
    where: {
      accountId: ctx.accountId,
      // 🔴 Un asesor raso NO ve el embudo de sus compañeros. Sin este
      // recorte, cualquiera con commissions.view se llevaba los prospectos,
      // la conversión y los tiempos de respuesta de todo el equipo.
      assignedUserId: manage ? { not: null } : ctx.realtyUserId,
      createdAt: { gte: start, lt: end },
    },
    select: {
      assignedUserId: true,
      stage: true,
      createdAt: true,
      firstResponseAt: true,
    },
  });

  const byAgent = new Map<string, RealtyAgentPerfInput>();
  const get = (id: string, name: string, active: boolean): RealtyAgentPerfInput => {
    let row = byAgent.get(id);
    if (!row) {
      row = {
        realtyUserId: id,
        name,
        active,
        closedDeals: 0,
        closedVolume: 0,
        earnedCommission: 0,
        inProgressDeals: 0,
        inProgressCommission: 0,
        leads: 0,
        leadsWon: 0,
        responseMinutes: [],
      };
      byAgent.set(id, row);
    }
    return row;
  };

  const nameById = new Map(
    agents.map((a) => [a.id, { name: `${a.firstName} ${a.lastName}`.trim(), active: a.active }]),
  );

  for (const deal of periodDeals) {
    for (const split of deal.splits) {
      if (!split.realtyUserId) continue;
      const meta = nameById.get(split.realtyUserId);
      const row = get(split.realtyUserId, meta?.name ?? split.beneficiary, meta?.active ?? false);
      if (deal.status === "CERRADO") {
        row.closedDeals += 1;
        row.closedVolume = (toCents(row.closedVolume) + toCents(deal.amount)) / 100;
        row.earnedCommission = (toCents(row.earnedCommission) + toCents(split.amount)) / 100;
      } else if (deal.status === "EN_PROCESO") {
        row.inProgressDeals += 1;
        row.inProgressCommission =
          (toCents(row.inProgressCommission) + toCents(split.amount)) / 100;
      }
    }
  }

  for (const lead of leads) {
    const id = lead.assignedUserId as string;
    const meta = nameById.get(id);
    if (!meta) continue; // un asignado de otra cuenta no existe: se ignora
    const row = get(id, meta.name, meta.active);
    row.leads += 1;
    if (lead.stage === "CIERRE") row.leadsWon += 1;
    if (lead.firstResponseAt) {
      const minutes = Math.max(
        0,
        Math.round((lead.firstResponseAt.getTime() - lead.createdAt.getTime()) / 60000),
      );
      row.responseMinutes.push(minutes);
    }
  }

  // Los asesores activos sin números salen igual: un cero visible es
  // información, una fila ausente parece un error de la pantalla.
  for (const a of agents) {
    if (a.active) get(a.id, `${a.firstName} ${a.lastName}`.trim(), true);
  }

  const all = Array.from(byAgent.values());
  // Sin commissions.manage el tablero es el SUYO, no el del equipo.
  return buildRanking(manage ? all : all.filter((r) => r.realtyUserId === ctx.realtyUserId));
}

// ── Escritura: la operación ────────────────────────────────────────────

export interface DealInput {
  propertyId?: unknown;
  kind?: unknown;
  contactId?: unknown;
  amount?: unknown;
  commissionAmount?: unknown;
  closedAt?: unknown;
  status?: unknown;
  notes?: unknown;
}

const DEAL_KINDS: RealtyDealKind[] = ["VENTA", "RENTA"];
const DEAL_STATUSES: RealtyDealStatus[] = ["EN_PROCESO", "CERRADO", "CANCELADO"];

function moneyToDecimal(value: unknown, field: string): Prisma.Decimal {
  const cents = toCents(value);
  if (cents < 0) throw new RealtyAdminError(`${field} no puede ser negativo.`);
  if (cents > 99_999_999_999_999) throw new RealtyAdminError(`${field} es demasiado grande.`);
  return new Prisma.Decimal((cents / 100).toFixed(2));
}

function parseDate(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** El inmueble es de la cuenta y de una oficina que la sesión alcanza. */
async function loadProperty(ctx: RealtyContext, propertyId: string) {
  const officeIds = await getAccessibleOfficeIds(ctx);
  const property = await prisma.realtyProperty.findFirst({
    where: {
      id: propertyId,
      accountId: ctx.accountId,
      OR: [{ officeId: { in: officeIds } }, { officeId: null }],
    },
    select: { id: true, title: true, status: true, operation: true },
  });
  if (!property) throw new RealtyAdminError("Ese inmueble no es tuyo.", 404, "NOT_FOUND");
  return property;
}

/** El estatus comercial que deja una operación cerrada. */
function statusAfterClose(kind: RealtyDealKind): "VENDIDO" | "RENTADO" {
  return kind === "VENTA" ? "VENDIDO" : "RENTADO";
}

/**
 * Registra una venta o renta cerrada.
 *
 * Al CERRAR, el inmueble pasa a VENDIDO o RENTADO. Eso es TODO lo que hace
 * aquí: la despublicación de los portales la dispara ese cambio de estatus
 * en la ola de portales — esta función no la llama ni la conoce.
 */
export async function createDeal(ctx: RealtyContext, input: DealInput): Promise<RealtyDealRow> {
  assertRealtyArea(ctx, "comisiones");
  assertRealtyPermission(ctx, "deals.manage");

  const propertyId = typeof input.propertyId === "string" ? input.propertyId : "";
  if (!propertyId) throw new RealtyAdminError("Elige el inmueble de la operación.");
  const property = await loadProperty(ctx, propertyId);

  const kind: RealtyDealKind = DEAL_KINDS.includes(input.kind as RealtyDealKind)
    ? (input.kind as RealtyDealKind)
    : property.operation === "RENTA"
      ? "RENTA"
      : "VENTA";
  const status: RealtyDealStatus = DEAL_STATUSES.includes(input.status as RealtyDealStatus)
    ? (input.status as RealtyDealStatus)
    : "CERRADO";

  const amount = moneyToDecimal(input.amount, "El monto de la operación");
  const commissionAmount = moneyToDecimal(input.commissionAmount, "La comisión");
  if (toCents(amount) === 0) {
    throw new RealtyAdminError("Captura en cuánto se cerró la operación.");
  }
  if (toCents(commissionAmount) > toCents(amount)) {
    throw new RealtyAdminError("La comisión no puede ser mayor que la operación.");
  }

  const closedAt = status === "CERRADO" ? (parseDate(input.closedAt) ?? new Date()) : null;

  let contactId: string | null = null;
  if (typeof input.contactId === "string" && input.contactId) {
    const contact = await prisma.realtyContact.findFirst({
      where: { id: input.contactId, accountId: ctx.accountId },
      select: { id: true },
    });
    if (!contact) throw new RealtyAdminError("Ese cliente no es de tu cuenta.", 404, "NOT_FOUND");
    contactId = contact.id;
  }

  const created = await prisma.$transaction(async (tx) => {
    const deal = await tx.realtyDeal.create({
      data: {
        accountId: ctx.accountId,
        propertyId: property.id,
        kind,
        contactId,
        amount,
        commissionAmount,
        status,
        closedAt,
        notes: typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) || null : null,
      },
      select: { id: true },
    });
    if (status === "CERRADO") {
      await tx.realtyProperty.updateMany({
        where: { id: property.id, accountId: ctx.accountId },
        data: { status: statusAfterClose(kind) },
      });
    }
    return deal.id;
  });

  return loadDealRow(ctx, created);
}

export async function updateDeal(
  ctx: RealtyContext,
  dealId: string,
  input: DealInput,
): Promise<RealtyDealRow> {
  assertRealtyArea(ctx, "comisiones");
  assertRealtyPermission(ctx, "deals.manage");
  await loadDealInScope(ctx, dealId);
  const current = await prisma.realtyDeal.findFirst({
    where: { id: dealId, accountId: ctx.accountId },
    select: {
      id: true,
      kind: true,
      status: true,
      propertyId: true,
      commissionAmount: true,
      amount: true,
      splits: { select: { id: true, pct: true, paidAt: true } },
    },
  });
  if (!current) throw new RealtyAdminError("Esa operación no es de tu cuenta.", 404, "NOT_FOUND");

  const data: Prisma.RealtyDealUpdateInput = {};
  if (input.kind !== undefined && DEAL_KINDS.includes(input.kind as RealtyDealKind)) {
    data.kind = input.kind as RealtyDealKind;
  }
  if (input.amount !== undefined) data.amount = moneyToDecimal(input.amount, "El monto");
  if (input.commissionAmount !== undefined) {
    data.commissionAmount = moneyToDecimal(input.commissionAmount, "La comisión");
  }
  if (input.notes !== undefined) {
    data.notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) || null : null;
  }
  if (input.closedAt !== undefined) data.closedAt = parseDate(input.closedAt);

  const nextStatus: RealtyDealStatus = DEAL_STATUSES.includes(input.status as RealtyDealStatus)
    ? (input.status as RealtyDealStatus)
    : current.status;
  const nextKind = (data.kind as RealtyDealKind | undefined) ?? current.kind;

  const nextAmount = (data.amount as Prisma.Decimal | undefined) ?? current.amount;
  const nextCommission =
    (data.commissionAmount as Prisma.Decimal | undefined) ?? current.commissionAmount;
  if (toCents(nextCommission) > toCents(nextAmount)) {
    throw new RealtyAdminError("La comisión no puede ser mayor que la operación.");
  }

  // Cancelar una operación con comisiones YA PAGADAS reescribiría el pasado:
  // ese dinero salió de la caja y el ajuste va en el periodo siguiente.
  if (nextStatus === "CANCELADO" && current.splits.some((s) => s.paidAt)) {
    throw new RealtyAdminError(
      "Esta operación ya tiene comisiones pagadas. Ajústalas en el periodo siguiente en vez de cancelarla.",
      409,
      "COMMISSION_PAID",
    );
  }

  if (nextStatus !== current.status) {
    data.status = nextStatus;
    if (nextStatus === "CERRADO" && !parseDate(input.closedAt)) data.closedAt = new Date();
    if (nextStatus !== "CERRADO") data.closedAt = null;
  }

  // Si cambió la comisión, las partes por porcentaje se recalculan: dejarlas
  // con el importe viejo es la forma silenciosa de que el reparto deje de
  // sumar el 100% y nadie se entere hasta el día de pago.
  const commissionChanged = toCents(nextCommission) !== toCents(current.commissionAmount);

  await prisma.$transaction(async (tx) => {
    await tx.realtyDeal.update({ where: { id: current.id }, data });

    if (commissionChanged && current.splits.length > 0) {
      const recomputed = computeSplits(
        nextCommission.toString(),
        current.splits.map((s) => ({
          key: s.id,
          party: "COLOCADOR" as RealtyCommissionParty,
          mode: "PCT" as const,
          pct: Number(s.pct),
        })),
      );
      for (const row of recomputed.rows) {
        await tx.realtyCommissionSplit.update({
          where: { id: row.key },
          data: { amount: new Prisma.Decimal(row.amount.toFixed(2)) },
        });
      }
    }

    if (nextStatus === "CERRADO") {
      await tx.realtyProperty.updateMany({
        where: { id: current.propertyId, accountId: ctx.accountId },
        data: { status: statusAfterClose(nextKind) },
      });
    } else if (current.status === "CERRADO") {
      // Se deshizo un cierre: el inmueble vuelve a estar disponible, pero
      // SOLO si sigue marcado como vendido/rentado por esta operación.
      await tx.realtyProperty.updateMany({
        where: {
          id: current.propertyId,
          accountId: ctx.accountId,
          status: { in: ["VENDIDO", "RENTADO"] },
        },
        data: { status: "DISPONIBLE" },
      });
    }
  });

  return loadDealRow(ctx, current.id);
}

async function loadDealRow(ctx: RealtyContext, dealId: string): Promise<RealtyDealRow> {
  const officeIds = await getAccessibleOfficeIds(ctx);
  const row = (await prisma.realtyDeal.findFirst({
    where: {
      id: dealId,
      accountId: ctx.accountId,
      property: { OR: [{ officeId: { in: officeIds } }, { officeId: null }] },
    },
    select: DEAL_SELECT,
  })) as DealRaw | null;
  if (!row) throw new RealtyAdminError("Esa operación no es de tu cuenta.", 404, "NOT_FOUND");
  return toDealRow(row);
}

// ── Escritura: el reparto ──────────────────────────────────────────────

/**
 * Reemplaza el reparto COMPLETO de una operación. Se manda entero, nunca por
 * partes: un reparto a medias no cierra y no se puede validar.
 *
 * 🔴 Las partes YA PAGADAS no se tocan. Reescribir un importe que ya salió de
 * la caja es cambiar el pasado; si hay que corregirlo, primero se desmarca
 * el pago (y eso queda a la vista de todos en la pantalla).
 */
export async function setDealSplits(
  ctx: RealtyContext,
  dealId: string,
  rows: unknown,
): Promise<RealtyDealRow> {
  assertRealtyArea(ctx, "comisiones");
  assertRealtyPermission(ctx, "commissions.manage");
  await loadDealInScope(ctx, dealId);

  const deal = await prisma.realtyDeal.findFirst({
    where: { id: dealId, accountId: ctx.accountId },
    select: {
      id: true,
      commissionAmount: true,
      splits: { select: { id: true, paidAt: true } },
    },
  });
  if (!deal) throw new RealtyAdminError("Esa operación no es de tu cuenta.", 404, "NOT_FOUND");

  if (deal.splits.some((s) => s.paidAt)) {
    throw new RealtyAdminError(
      "Ya hay partes pagadas de esta comisión. Desmárcalas antes de cambiar el reparto.",
      409,
      "COMMISSION_PAID",
    );
  }

  if (!Array.isArray(rows)) throw new RealtyAdminError("Reparto inválido.");
  if (rows.length > 12) throw new RealtyAdminError("Son demasiadas partes para un reparto.");

  const inputs: RealtySplitInput[] = rows.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      key: `s${i}`,
      party: (r.party as RealtyCommissionParty) ?? "COLOCADOR",
      realtyUserId: typeof r.realtyUserId === "string" && r.realtyUserId ? r.realtyUserId : null,
      externalName: typeof r.externalName === "string" ? r.externalName : null,
      mode: r.mode === "AMOUNT" ? "AMOUNT" : "PCT",
      pct: r.pct,
      amount: r.amount,
    };
  });

  const result = computeSplits(deal.commissionAmount.toString(), inputs);
  if (!result.valid) {
    // El primer problema es el que la pantalla enseña arriba; el mismo texto
    // que ya vio mientras escribía, porque el motor es el mismo.
    throw new RealtyAdminError(result.problems[0]?.message ?? "El reparto no cierra.", 400, "SPLIT_INVALID");
  }

  // Los usuarios que cobran tienen que ser de ESTA cuenta.
  const userIds = Array.from(
    new Set(result.rows.map((r) => r.realtyUserId).filter((id): id is string => Boolean(id))),
  );
  if (userIds.length > 0) {
    const found = await prisma.realtyUser.count({
      where: { accountId: ctx.accountId, id: { in: userIds } },
    });
    if (found !== userIds.length) {
      throw new RealtyAdminError("Alguien del reparto no es de tu equipo.", 404, "NOT_FOUND");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.realtyCommissionSplit.deleteMany({
      where: { dealId: deal.id, accountId: ctx.accountId },
    });
    if (result.rows.length > 0) {
      await tx.realtyCommissionSplit.createMany({
        data: result.rows.map((r) => ({
          accountId: ctx.accountId,
          dealId: deal.id,
          realtyUserId: r.realtyUserId,
          party: r.party,
          pct: new Prisma.Decimal(r.pct.toFixed(2)),
          amount: new Prisma.Decimal(r.amount.toFixed(2)),
          externalName: r.externalName,
        })),
      });
    }
  });

  return loadDealRow(ctx, deal.id);
}

/** Marca (o desmarca) pagada UNA parte del reparto. */
export async function setSplitPaid(
  ctx: RealtyContext,
  splitId: string,
  paid: boolean,
): Promise<RealtyDealRow> {
  assertRealtyArea(ctx, "comisiones");
  assertRealtyPermission(ctx, "commissions.manage");
  const officeIds = await getAccessibleOfficeIds(ctx);
  const split = await prisma.realtyCommissionSplit.findFirst({
    where: {
      id: splitId,
      accountId: ctx.accountId,
      // El mismo recorte de oficina que la lectura: con el id de un split de
      // otra sucursal en la mano, esto ya no lo marca pagado.
      deal: { property: { OR: [{ officeId: { in: officeIds } }, { officeId: null }] } },
    },
    select: { id: true, dealId: true, deal: { select: { status: true } } },
  });
  if (!split) throw new RealtyAdminError("Esa comisión no es de tu cuenta.", 404, "NOT_FOUND");

  if (paid && split.deal.status !== "CERRADO") {
    throw new RealtyAdminError(
      "Todavía no se puede pagar: la operación no está cerrada.",
      409,
      "DEAL_NOT_CLOSED",
    );
  }

  await prisma.realtyCommissionSplit.updateMany({
    where: { id: split.id, accountId: ctx.accountId },
    data: { paidAt: paid ? new Date() : null },
  });
  return loadDealRow(ctx, split.dealId);
}

/** Marca pagadas TODAS las partes pendientes de un beneficiario en el periodo. */
export async function payBeneficiaryPeriod(
  ctx: RealtyContext,
  params: {
    realtyUserId?: string | null;
    party?: string | null;
    /** Obligatorio cuando el beneficiario es EXTERNO: es lo que lo identifica. */
    externalName?: string | null;
    periodKey: string;
  },
): Promise<{ marked: number }> {
  assertRealtyArea(ctx, "comisiones");
  assertRealtyPermission(ctx, "commissions.manage");
  const tz = accountTz(ctx);
  if (!isValidPeriodKey(params.periodKey)) {
    throw new RealtyAdminError("Periodo inválido (usa AAAA-MM).");
  }
  const { start, end } = periodRange(params.periodKey, tz);
  const officeIds = await getAccessibleOfficeIds(ctx);

  const where: Prisma.RealtyCommissionSplitWhereInput = {
    accountId: ctx.accountId,
    paidAt: null,
    deal: {
      status: "CERRADO",
      closedAt: { gte: start, lt: end },
      // Sin esto, "pagar todo" de un beneficiario alcanzaba operaciones de
      // sucursales que quien paga ni siquiera puede ver.
      property: { OR: [{ officeId: { in: officeIds } }, { officeId: null }] },
    },
  };
  if (params.realtyUserId) {
    // El id viene del navegador: si es de otra cuenta no casa con el
    // accountId del where y no marca nada — pero se comprueba igual para
    // devolver un 404 honesto en vez de un "0 pagados" que confunde.
    const target = await prisma.realtyUser.findFirst({
      where: { id: params.realtyUserId, accountId: ctx.accountId },
      select: { id: true },
    });
    if (!target) throw new RealtyAdminError("Esa persona no es de tu equipo.", 404, "NOT_FOUND");
    where.realtyUserId = target.id;
  } else if (params.party) {
    // Un party basura llegaba crudo a Prisma y salía un 500 sin explicación.
    if (!(params.party in REALTY_COMMISSION_PARTY_LABELS)) {
      throw new RealtyAdminError("Ese tipo de participante no existe.");
    }
    const party = params.party as RealtyCommissionParty;
    where.party = party;
    where.realtyUserId = null;
    if (party === "EXTERNO") {
      // 🔴 Sin el nombre, "pagar todo" de un asesor externo marcaba pagadas
      // las partes de TODAS las contrapartes externas del periodo. Son
      // personas distintas y es dinero distinto.
      const name = typeof params.externalName === "string" ? params.externalName.trim() : "";
      if (!name) {
        throw new RealtyAdminError("Di de quién es esa parte externa.", 400, "MISSING_EXTERNAL");
      }
      where.externalName = name;
    }
  } else {
    throw new RealtyAdminError("Di a quién le estás pagando.");
  }

  const res = await prisma.realtyCommissionSplit.updateMany({ where, data: { paidAt: new Date() } });
  return { marked: res.count };
}
