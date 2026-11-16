import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasBarberPermission, type BarberContext } from "@/lib/barber-auth";
import { barberCanSeeClient } from "@/lib/barber/clients";
import { D, isSaleCancelled, sumMoney, toNum } from "@/lib/barber/commissions";
import { NOT_CANCELLED, parseLoyaltyLine } from "@/lib/barber/loyalty-core";
import {
  isDepositLine,
  isDepositRefundLine,
  saleKindOf,
  type BarberSaleKind,
} from "@/lib/barber/memberships-core";
import { clientsViewScope, scopeUserFromCtx } from "@/lib/barber/own-visits";
import { originalSummaryOf } from "@/lib/barber/stars-core";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { CANCELLED_MARK } from "@/lib/barber/commissions";
import {
  NO_SALES_FILTER,
  cancelInfoOf,
  salesPeriodStart,
  ticketShortId,
  type ClientSalesFilter,
} from "@/lib/barber/ficha-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — los COBROS de un cliente (su historial de tickets).
 *
 * Solo LECTURA de los tickets que ya escribe Caja (barber_sales). No hay un
 * segundo motor de cobro: un cobro hecho desde la ficha ES un ticket de Caja
 * (createSale), así que aparece aquí, en el corte, en Inicio, en Reportes, en
 * comisiones y en estrellas exactamente igual.
 *
 * Quién ve qué (lo decide el servidor con la sesión):
 *   · Con alcance completo de clientes (dueño, encargado, recepción): hace
 *     falta además cash.view, porque son importes.
 *   · Rol Barbero en un cliente SUYO: solo los tickets que cobró a su nombre
 *     (barberId = su ficha). Misma regla que el historial de cortes.
 *   · Todo por la barbería/sede de la sesión (ctx.barbershopId).
 * ═══════════════════════════════════════════════════════════════════════
 */

export const CLIENT_SALES_PAGE_SIZE = 20;

export type ClientSaleLineKind = "service" | "product" | "discount" | "bonus" | "deposit" | "other";

export interface ClientSaleLine {
  kind: ClientSaleLineKind;
  description: string;
  qty: number;
  unitPrice: number;
  /** Servicio que quedó en $0 por un bono de estrellas. */
  free: boolean;
}

export interface ClientSaleRow {
  id: string;
  createdAt: string;
  status: "paid" | "cancelled";
  /** sale = cobro normal; membership / deposit / refund = ticket de mostrador. */
  kind: BarberSaleKind;
  barberName: string | null;
  soldByName: string;
  paymentMethod: BarberPaymentMethod;
  lines: ClientSaleLine[];
  /** Descuento del ticket (en positivo). */
  discount: number;
  /** Lo que rebajó un bono de estrellas en pesos (en positivo). */
  bonusDiscount: number;
  /** Nombre del bono aplicado, si hubo. */
  bonusName: string | null;
  tip: number;
  total: number;
  /** Lo que llevaba un ticket cancelado (sus líneas ya no existen). */
  cancelledSummary: string | null;
  /** Total que tenía antes de cancelarse (de la marca «… total X (MÉTODO)»). */
  cancelledTotal: number | null;
  /** Quién lo canceló y por qué (de la misma marca). */
  cancelledBy: string | null;
  cancelReason: string | null;
  /** Folio corto, el mismo del ticket impreso (#3F9A2C). */
  shortId: string;
  /**
   * Su turno de caja sigue abierto: solo entonces Caja deja cambiar el método
   * o cancelar (el servidor lo vuelve a revisar). Sin turno → false.
   */
  sessionOpen: boolean;
  /** Entró a un turno de caja (los cobros en línea pueden no tenerlo). */
  hasSession: boolean;
}

export interface ClientSalesPage {
  /** false = sin permiso para ver importes (la pantalla no pinta la sección). */
  allowed: boolean;
  /** "own" = rol Barbero: solo lo que cobró él. */
  scope: "all" | "own";
  rows: ClientSaleRow[];
  page: number;
  pageSize: number;
  /** Tickets (pagados y cancelados) en el alcance, con el filtro aplicado (paginación). */
  count: number;
  /** El filtro con que se pidió esta página. */
  filter: ClientSalesFilter;
  /** Conteos SIN filtro, para las pastillas «Todos · Pagados · Cancelados». */
  totals: { all: number; paid: number; cancelled: number };
  summary: {
    /** Σ total de los tickets pagados (incluye propina). */
    spent: number;
    /** Tickets pagados con al menos un servicio. */
    chargedVisits: number;
    paidTickets: number;
  };
}

function emptyPage(allowed: boolean, scope: "all" | "own", page = 1): ClientSalesPage {
  return {
    allowed,
    scope,
    rows: [],
    page,
    pageSize: CLIENT_SALES_PAGE_SIZE,
    count: 0,
    filter: NO_SALES_FILTER,
    totals: { all: 0, paid: 0, cancelled: 0 },
    summary: { spent: 0, chargedVisits: 0, paidTickets: 0 },
  };
}

const saleSelect = {
  id: true,
  createdAt: true,
  notes: true,
  tip: true,
  total: true,
  paymentMethod: true,
  cashSessionId: true,
  cashSession: { select: { closedAt: true } },
  barber: { select: { name: true, nickname: true } },
  soldBy: { select: { firstName: true, lastName: true } },
  items: {
    orderBy: { id: "asc" as const },
    select: { description: true, qty: true, unitPrice: true, serviceId: true, productId: true },
  },
} satisfies Prisma.BarberSaleSelect;

type SaleRowRaw = Prisma.BarberSaleGetPayload<{ select: typeof saleSelect }>;

/** Clasifica una línea del ticket (puro, para la prueba). */
export function classifySaleLine(it: {
  description: string;
  unitPrice: number;
  serviceId: string | null;
  productId: string | null;
}): { kind: ClientSaleLineKind; free: boolean } {
  const loyalty = parseLoyaltyLine(it.description);
  if (it.serviceId) return { kind: "service", free: loyalty?.kind === "free" };
  if (it.productId) return { kind: "product", free: false };
  if (loyalty) return { kind: "bonus", free: false };
  if (isDepositLine(it.description) || isDepositRefundLine(it.description)) return { kind: "deposit", free: false };
  if (it.unitPrice < 0) return { kind: "discount", free: false };
  return { kind: "other", free: false };
}

/** El total que tenía un ticket cancelado, leído de su marca. */
export function cancelledTotalOf(notes: string | null | undefined): number | null {
  if (typeof notes !== "string") return null;
  const m = / · total (\d+(?:\.\d{1,2})?) \([A-Z]+\)/.exec(notes.split("\n")[0]);
  return m ? Number(m[1]) : null;
}

export function toClientSaleRow(s: SaleRowRaw): ClientSaleRow {
  const cancelled = isSaleCancelled(s);
  const lines: ClientSaleLine[] = s.items.map((it) => {
    const unitPrice = toNum(it.unitPrice);
    const c = classifySaleLine({ ...it, unitPrice });
    return { kind: c.kind, free: c.free, description: it.description, qty: it.qty, unitPrice };
  });
  const sumOf = (kind: ClientSaleLineKind) =>
    toNum(sumMoney(s.items.filter((_, i) => lines[i].kind === kind).map((it) => D(it.unitPrice).times(it.qty))).abs());
  const bonusLine = s.items.map((it) => parseLoyaltyLine(it.description)).find((x) => x !== null) ?? null;
  return {
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    status: cancelled ? "cancelled" : "paid",
    kind: saleKindOf(s.notes),
    barberName: s.barber ? s.barber.nickname || s.barber.name : null,
    soldByName: `${s.soldBy?.firstName ?? ""} ${s.soldBy?.lastName ?? ""}`.trim() || "—",
    paymentMethod: s.paymentMethod as BarberPaymentMethod,
    lines,
    discount: sumOf("discount"),
    bonusDiscount: sumOf("bonus"),
    bonusName: bonusLine ? (bonusLine.kind === "free" ? bonusLine.head : bonusLine.bonusName) : null,
    tip: toNum(s.tip),
    total: toNum(s.total),
    cancelledSummary: cancelled ? originalSummaryOf(s.notes) || null : null,
    cancelledTotal: cancelled ? cancelledTotalOf(s.notes) : null,
    ...(() => {
      const info = cancelled ? cancelInfoOf(s.notes, CANCELLED_MARK) : null;
      return { cancelledBy: info?.by ?? null, cancelReason: info?.reason ?? null };
    })(),
    shortId: ticketShortId(s.id),
    sessionOpen: Boolean(s.cashSessionId && s.cashSession && !s.cashSession.closedAt),
    hasSession: Boolean(s.cashSessionId),
  };
}

/**
 * Los cobros de un cliente, más recientes primero, paginados, con el total
 * pagado y las visitas cobradas arriba (sobre TODO su historial, no la página).
 */
export async function listClientSales(
  ctx: BarberContext,
  clientId: string,
  opts: { page?: number; filter?: ClientSalesFilter } = {},
): Promise<ClientSalesPage> {
  const filter = opts.filter ?? NO_SALES_FILTER;
  const page = Math.max(1, Math.floor(Number(opts.page) || 1));
  const perm = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const scope = clientsViewScope(scopeUserFromCtx(ctx));
  if (!hasBarberPermission(perm, "clients.view") || scope.kind === "none") return emptyPage(false, "all", page);
  if (scope.kind === "all" && !hasBarberPermission(perm, "cash.view")) return emptyPage(false, "all", page);
  const scopeKind: "all" | "own" = scope.kind === "own" ? "own" : "all";

  if (!clientId || !(await barberCanSeeClient(ctx, clientId))) return emptyPage(false, scopeKind, page);

  const where: Prisma.BarberSaleWhereInput = {
    barbershopId: ctx.barbershopId,
    clientId,
    ...(scope.kind === "own" ? { barberId: scope.barberId } : {}),
  };
  const paid: Prisma.BarberSaleWhereInput = { AND: [where, NOT_CANCELLED] };
  // La lista (y su paginación) lleva el filtro; las cifras de arriba, no.
  const since = salesPeriodStart(filter.period);
  const listed: Prisma.BarberSaleWhereInput = {
    AND: [
      where,
      ...(filter.status === "paid" ? [NOT_CANCELLED] : []),
      ...(filter.status === "cancelled" ? [{ notes: { startsWith: CANCELLED_MARK } }] : []),
      ...(since ? [{ createdAt: { gte: since } }] : []),
      ...(filter.method !== "all" ? [{ paymentMethod: filter.method }] : []),
    ],
  };

  const [all, count, rows, spent, visits] = await Promise.all([
    prisma.barberSale.count({ where }),
    prisma.barberSale.count({ where: listed }),
    prisma.barberSale.findMany({
      where: listed,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * CLIENT_SALES_PAGE_SIZE,
      take: CLIENT_SALES_PAGE_SIZE,
      select: saleSelect,
    }),
    prisma.barberSale.aggregate({ where: paid, _sum: { total: true }, _count: { _all: true } }),
    prisma.barberSale.count({ where: { AND: [paid, { items: { some: { serviceId: { not: null } } } }] } }),
  ]);

  return {
    allowed: true,
    scope: scopeKind,
    rows: rows.map(toClientSaleRow),
    page,
    pageSize: CLIENT_SALES_PAGE_SIZE,
    count,
    filter,
    totals: { all, paid: spent._count._all, cancelled: Math.max(0, all - spent._count._all) },
    summary: {
      spent: toNum(spent._sum.total ?? D(0)),
      chargedVisits: visits,
      paidTickets: spent._count._all,
    },
  };
}
