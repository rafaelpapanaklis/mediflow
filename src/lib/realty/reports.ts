/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl INMUEBLES — CONSULTAS de los reportes del negocio.
 *
 * La aritmética y la prosa viven en owner-report.ts (puro, client-safe).
 * Aquí SOLO se consulta y se arma el DTO. Esa frontera es la que permite
 * que la pantalla, el PDF y la hoja de cálculo digan el mismo número:
 * los tres consumen el mismo DTO de aquí y el mismo cálculo de allá.
 *
 * ── LO QUE ESTE ARCHIVO NO PUEDE INVENTAR ──────────────────────────────
 * Tres datos que el negocio pediría y que HOY no tienen fuente. Se dicen
 * aquí para que nadie los reinvente creyendo que se olvidaron:
 *
 *   1. VISTAS por portal o en la web. No existe ninguna tabla de analítica
 *      en el vertical, ningún contador en RealtyProperty y ningún portal
 *      nos devuelve sus estadísticas (el feed es de una sola vía). Lo que
 *      sí sabemos es cuánta gente ESCRIBIÓ desde cada portal, y eso es lo
 *      que se reporta, con ese nombre. Decirle al propietario "tu casa se
 *      vio 340 veces" sería inventarle el número.
 *   2. OFERTAS con monto. No hay tabla de ofertas: `OFERTA` es una etapa
 *      del prospecto y no guarda importe. Se cuentan las etapas OFERTA y
 *      las operaciones EN_PROCESO, que sí son ofertas formales con monto.
 *   3. RETENCIÓN FISCAL. En este vertical "retenido" es la comisión de
 *      administración que la inmobiliaria se queda, NO un impuesto. El
 *      resumen anual lo dice con todas sus letras: confundirlos sería
 *      decirle al arrendador que le retuvimos ISR.
 *
 * ── AISLAMIENTO ────────────────────────────────────────────────────────
 * accountId SIEMPRE del ctx, nunca del request (un undefined en un where
 * de Prisma BORRA el filtro). El recorte por oficina va por la relación
 * `property`, porque ni el contrato, ni el cargo, ni el pago, ni el gasto
 * tienen officeId propio. Y siempre con el OR de `officeId: null`: un
 * inmueble sin oficina es cartera de la casa y un `in` a secas lo
 * desaparecería del reporte.
 *
 * ── MONEDA ─────────────────────────────────────────────────────────────
 * Ningún movimiento de dinero guarda su moneda. Se hereda:
 *   · gasto, mantenimiento y operación  → property.currency
 *   · cargo de renta y su pago          → lease.currency
 * Y pueden NO coincidir (una casa listada en dólares rentada en pesos).
 * Por eso todo total viaja en MoneyByCurrency y ningún porcentaje se emite
 * cruzando monedas. Ver la cabecera de owner-report.ts.
 * ═══════════════════════════════════════════════════════════════════════
 */
import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { getRealtyPlan } from "@/lib/realty/plans";
import { REALTY_ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/realty/plan-shared";
import {
  getAccessibleOfficeIds,
  hasRealtyPermission,
  type RealtyContext,
  type RealtyPermissionKey,
} from "@/lib/realty-auth";
import type {
  RealtyCurrency,
  RealtyExpenseKind,
  RealtyLeadStage,
  RealtyPropertyKind,
} from "@/lib/realty/types";
import {
  REALTY_LEAD_STAGE_UI,
  REALTY_LOST_REASON_LABELS,
} from "@/lib/realty/types";
import {
  REALTY_AGING_UI,
  agingBucket,
  chargeBalance,
  centsToNumber,
  formatCents,
  monthKey,
  sumCentsBy,
  toCents,
  todayInTimezone,
  type RealtyAgingKey,
} from "@/lib/realty/rent-charges";
import {
  REALTY_DEFAULT_TZ,
  buildRanking,
  buildReceipt,
  zonedMidnightUtc,
  type RealtyAgentPerf,
  type RealtyReceipt,
  type RealtyReceiptSplitRow,
} from "@/lib/realty/commissions";
import {
  addAmount,
  addCents,
  asCurrency,
  activeCurrencies,
  buildCsvReport,
  buildOwnerRecommendation,
  computeYield,
  csvAmount,
  csvDate,
  csvMoneyCells,
  csvMoneyHeaders,
  emptyMoney,
  hasFeedback,
  // `looksLikeLiked` y `looksLikePriceObjection` NO se importan aquí a
  // propósito: se llegan a través de `readVisitFeedback`, que es la costura
  // única con O2-T3. Llamarlas sueltas desde este archivo abriría un
  // segundo camino que el día del cambio se quedaría atrás.
  readVisitFeedback,
  medianOf,
  mergeMoney,
  priceDeltaPct,
  sumMoneyList,
  visitHappened,
  yieldBlockedText,
  type CsvBlock,
  type MoneyByCurrency,
  type OwnerActivityReport,
  type OwnerReportOfferLine,
  type OwnerReportPortalLine,
  type OwnerReportResponse,
  type OwnerReportVisitLine,
  type OwnerReportZone,
  type YieldResult,
} from "@/lib/realty/owner-report";

// ═══════════════════════════════════════════════════════════════════════
// 0. PERIODO
// ═══════════════════════════════════════════════════════════════════════

export interface ReportRange {
  /** "YYYY-MM-DD" inclusivo. */
  from: string;
  /** "YYYY-MM-DD" inclusivo (el rango interno es [start, end) ). */
  to: string;
  start: Date;
  end: Date;
  /** Meses que abarca, para poder anualizar un rendimiento. Mínimo 1. */
  months: number;
  days: number;
  timezone: string;
}

export function accountTimezone(ctx: RealtyContext): string {
  return ctx.account.timezone || REALTY_DEFAULT_TZ;
}

function parseYmd(value: unknown): { y: number; m: number; d: number } | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function ymd(date: Date, tz: string): string {
  try {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return f.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Rango [start, end) en la zona de la cuenta. El corte de un periodo NO es
 * el periodo UTC: una operación cerrada el 31 a las 8 de la noche en Cancún
 * cae en el mes siguiente si se calcula en UTC. Mismo criterio que T8.
 *
 * Por omisión, los últimos 12 meses cumplidos hasta hoy.
 */
export function resolveRange(
  ctx: RealtyContext,
  fromRaw?: string | null,
  toRaw?: string | null,
  now: Date = new Date(),
): ReportRange {
  const tz = accountTimezone(ctx);
  const todayStr = ymd(now, tz);
  const today = parseYmd(todayStr) as { y: number; m: number; d: number };

  const toParts = parseYmd(toRaw) ?? today;
  const defaultFrom = { y: toParts.y - 1, m: toParts.m, d: toParts.d };
  const fromParts = parseYmd(fromRaw) ?? defaultFrom;

  let start = zonedMidnightUtc(fromParts.y, fromParts.m, fromParts.d, tz);
  // `end` es el día siguiente al `to` a medianoche: el rango incluye el día
  // completo de `to`. Sin esto, un pago de las 3 de la tarde del último día
  // se quedaría fuera del corte y nadie entendería por qué.
  let end = zonedMidnightUtc(toParts.y, toParts.m, toParts.d + 1, tz);

  if (end.getTime() <= start.getTime()) {
    // Rango invertido (alguien escribió las fechas al revés en la URL): se
    // enderezan en vez de devolver un reporte vacío que parece un error.
    const swap = start;
    start = zonedMidnightUtc(toParts.y, toParts.m, toParts.d, tz);
    end = new Date(swap.getTime() + 24 * 60 * 60 * 1000);
  }

  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const months = Math.max(1, Math.round((days / 365.25) * 12));

  return {
    from: ymd(start, tz),
    to: ymd(new Date(end.getTime() - 1000), tz),
    start,
    end,
    months,
    days,
    timezone: tz,
  };
}

/** El año natural completo, en la zona de la cuenta. Para el resumen anual. */
export function resolveYearRange(ctx: RealtyContext, year: number): ReportRange {
  const tz = accountTimezone(ctx);
  const start = zonedMidnightUtc(year, 1, 1, tz);
  const end = zonedMidnightUtc(year + 1, 1, 1, tz);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    start,
    end,
    months: 12,
    days,
    timezone: tz,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. ALCANCE
// ═══════════════════════════════════════════════════════════════════════

/**
 * El recorte de inmuebles que este usuario puede ver. Punto ÚNICO: todas
 * las consultas de este archivo cuelgan de aquí, directamente o a través de
 * la relación `property`.
 */
export async function propertyScopeWhere(
  ctx: RealtyContext,
): Promise<Prisma.RealtyPropertyWhereInput> {
  const officeIds = await getAccessibleOfficeIds(ctx);
  return {
    accountId: ctx.accountId,
    OR: [{ officeId: { in: officeIds } }, { officeId: null }],
  };
}

/** El mismo recorte, pero para anidarlo bajo `property: { ... }`. */
export async function nestedPropertyScope(
  ctx: RealtyContext,
): Promise<Prisma.RealtyPropertyWhereInput> {
  const officeIds = await getAccessibleOfficeIds(ctx);
  return { OR: [{ officeId: { in: officeIds } }, { officeId: null }] };
}

function can(ctx: RealtyContext, key: RealtyPermissionKey): boolean {
  return hasRealtyPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    key,
  );
}

/**
 * Qué bloques del reporte puede ver este usuario.
 *
 * 🔴 El item de menú "reportes" pide SOLO `properties.view` y está en TODOS
 * los modos (ver REALTY_NAV_ITEMS). Eso es correcto para la puerta —un
 * asesor tiene que poder ver su embudo— pero sería un agujero para el
 * contenido: con esa sola llave, un AGENT llegaría al resumen fiscal con el
 * dinero completo de la cartera. El permiso abre la PUERTA; cada bloque
 * comprueba el SUYO.
 */
export interface ReportAccess {
  /** La puerta. Sin esto no se entra a la pantalla. */
  base: boolean;
  activity: boolean;
  portfolio: boolean;
  tax: boolean;
  profitability: boolean;
  funnel: boolean;
  commissions: boolean;
  collections: boolean;
  /**
   * ¿Puede MANDARLE el reporte al propietario por WhatsApp?
   *
   * No es lo mismo que `activity`: ver cómo va un inmueble no es lo mismo
   * que gastar un mensaje del cupo de la cuenta escribiéndole a un cliente
   * en nombre de la inmobiliaria. Vive aquí —y no suelto en la ruta— para
   * que el botón que se pinta y la ruta que se llama no puedan discrepar.
   */
  sendWhatsapp: boolean;
  /** El plan gatea rentas: sin ella no hay cobranza, ni gastos, ni fiscal. */
  planRentals: boolean;
  planCommissions: boolean;
  planLeads: boolean;
}

export function getReportAccess(ctx: RealtyContext): ReportAccess {
  const planRentals = ctx.plan.features.rentals === true;
  const planCommissions = ctx.plan.features.commissions === true;
  const planLeads = ctx.plan.features.leads === true;
  const money = can(ctx, "payments.manage") || can(ctx, "expenses.manage");

  return {
    base: can(ctx, "properties.view"),
    // La actividad del inmueble enseña nombres de prospectos y sus visitas.
    activity: can(ctx, "properties.view") && can(ctx, "leads.view"),
    portfolio: can(ctx, "properties.view") && money && planRentals,
    tax: money && planRentals,
    profitability: can(ctx, "properties.view") && money && planRentals,
    funnel: can(ctx, "leads.view") && planLeads,
    commissions: can(ctx, "commissions.view") && planCommissions,
    collections: can(ctx, "payments.manage") && planRentals,
    sendWhatsapp:
      can(ctx, "properties.view") &&
      can(ctx, "leads.view") &&
      can(ctx, "whatsapp.send") &&
      ctx.plan.features.whatsapp === true,
    planRentals,
    planCommissions,
    planLeads,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2. PIEZAS COMPARTIDAS
// ═══════════════════════════════════════════════════════════════════════

const PROPERTY_MINI = {
  id: true,
  title: true,
  currency: true,
  officeId: true,
  ownerId: true,
  price: true,
  rentPrice: true,
  kind: true,
  operation: true,
  status: true,
  city: true,
  colonia: true,
  createdAt: true,
} as const;

/**
 * Un pago con su inmueble y su moneda ya resueltos.
 *
 * 🔴 RealtyPayment NO tiene propertyId ni moneda: se llega por `charge →
 * lease → property`, por `lease → property` o por `deal → property`, y los
 * tres son nullable. La moneda del dinero de una renta es la del CONTRATO
 * (lease.currency), no la del inmueble: una casa listada en dólares puede
 * estar rentada en pesos y el pago es en pesos.
 */
const PAYMENT_SELECT = {
  id: true,
  amount: true,
  paidAt: true,
  method: true,
  reference: true,
  receiptUrl: true,
  chargeId: true,
  leaseId: true,
  dealId: true,
  charge: {
    select: {
      periodMonth: true,
      lease: { select: { currency: true, property: { select: PROPERTY_MINI } } },
    },
  },
  lease: { select: { currency: true, property: { select: PROPERTY_MINI } } },
  deal: { select: { id: true, property: { select: PROPERTY_MINI } } },
} as const;

type PaymentRow = Prisma.RealtyPaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;
type PropertyMini = Prisma.RealtyPropertyGetPayload<{ select: typeof PROPERTY_MINI }>;

interface ResolvedPayment {
  id: string;
  cents: number;
  paidAt: Date;
  method: string;
  reference: string | null;
  receiptUrl: string | null;
  periodMonth: string | null;
  property: PropertyMini | null;
  currency: RealtyCurrency;
  /** ¿Es dinero de una renta? (lo contrario es una comisión de operación) */
  isRent: boolean;
}

/**
 * Resuelve inmueble y moneda de un pago. Devuelve null cuando el pago no
 * cuelga de nada: no se puede saber ni de quién es ni en qué moneda está,
 * así que NO entra en ningún total (se cuenta aparte para que las cifras
 * cuadren y nadie crea que se perdió dinero).
 */
function resolvePayment(row: PaymentRow): ResolvedPayment | null {
  const viaCharge = row.charge?.lease ?? null;
  const viaLease = row.lease ?? null;
  const viaDeal = row.deal ?? null;

  let property: PropertyMini | null = null;
  let currency: RealtyCurrency | null = null;
  let isRent = false;

  if (viaCharge) {
    property = viaCharge.property ?? null;
    currency = asCurrency(viaCharge.currency);
    isRent = true;
  } else if (viaLease) {
    property = viaLease.property ?? null;
    currency = asCurrency(viaLease.currency);
    isRent = true;
  } else if (viaDeal) {
    property = viaDeal.property ?? null;
    // Una comisión no tiene moneda propia: hereda la del inmueble operado.
    currency = property ? asCurrency(property.currency) : null;
    isRent = false;
  }

  if (!currency) return null;

  return {
    id: row.id,
    cents: toCents(row.amount),
    paidAt: row.paidAt,
    method: String(row.method),
    reference: row.reference ?? null,
    receiptUrl: row.receiptUrl ?? null,
    periodMonth: row.charge?.periodMonth ?? null,
    property,
    currency,
    isRent,
  };
}

async function loadPayments(
  ctx: RealtyContext,
  range: ReportRange,
  extra: Prisma.RealtyPaymentWhereInput = {},
): Promise<{ rows: ResolvedPayment[]; orphans: number }> {
  const scope = await nestedPropertyScope(ctx);
  const where: Prisma.RealtyPaymentWhereInput = {
    accountId: ctx.accountId,
    paidAt: { gte: range.start, lt: range.end },
    // 🔴 EL RECORTE VA DENTRO DE `AND`, y `extra` ES OTRO ELEMENTO DEL AND.
    //
    // Antes el `OR` de las tres rutas al inmueble vivía en el primer nivel,
    // con `...extra` esparcido al lado. Funciona hoy —nadie pasa `extra`—
    // pero el día que alguien le mande un filtro que traiga su PROPIO `OR`,
    // el spread pisa el de aquí y el recorte por oficina desaparece EN
    // SILENCIO: la consulta seguiría devolviendo filas, solo que de más.
    // Dentro del AND los dos conviven y ninguno puede borrar al otro.
    AND: [
      {
        OR: [
          { charge: { lease: { property: scope } } },
          { lease: { property: scope } },
          { deal: { property: scope } },
        ],
      },
      extra,
    ],
  };

  const rows = await prisma.realtyPayment.findMany({
    where,
    select: PAYMENT_SELECT,
    orderBy: { paidAt: "asc" },
  });

  const out: ResolvedPayment[] = [];
  let orphans = 0;
  for (const r of rows) {
    const resolved = resolvePayment(r);
    if (resolved) out.push(resolved);
    else orphans += 1;
  }
  return { rows: out, orphans };
}

// ═══════════════════════════════════════════════════════════════════════
// 3. A · REPORTE DE ACTIVIDAD AL PROPIETARIO
// ═══════════════════════════════════════════════════════════════════════

/** Cuántas operaciones comparables hacen falta para atreverse a opinar. */
const ZONE_MIN_COMPARABLES = 3;

/**
 * Todo lo que pasó con UN inmueble en el periodo, con una lectura en texto
 * claro al final. Es lo que renueva una exclusiva.
 */
export async function getOwnerActivityReport(
  ctx: RealtyContext,
  args: { propertyId: string; from?: string | null; to?: string | null },
  now: Date = new Date(),
): Promise<OwnerActivityReport | null> {
  const range = resolveRange(ctx, args.from, args.to, now);
  const scope = await propertyScopeWhere(ctx);

  const property = await prisma.realtyProperty.findFirst({
    where: { ...scope, id: args.propertyId },
    select: {
      ...PROPERTY_MINI,
      address: true,
      isPublished: true,
      publicUrlSlug: true,
      builtM2: true,
      owner: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!property) return null;

  const currency = asCurrency(property.currency);

  const [listings, leads, visits, deals] = await Promise.all([
    prisma.realtyPortalListing.findMany({
      where: { accountId: ctx.accountId, propertyId: property.id },
      select: { portal: true, status: true, lastPushedAt: true },
    }),
    prisma.realtyLead.findMany({
      where: {
        accountId: ctx.accountId,
        propertyId: property.id,
        createdAt: { gte: range.start, lt: range.end },
      },
      select: {
        id: true,
        portal: true,
        stage: true,
        createdAt: true,
        firstResponseAt: true,
        contact: { select: { name: true, source: true } },
        activities: {
          where: { kind: { in: ["LLAMADA", "WHATSAPP", "CORREO"] } },
          select: { kind: true },
        },
      },
    }),
    prisma.realtyVisit.findMany({
      where: {
        accountId: ctx.accountId,
        propertyId: property.id,
        scheduledAt: { gte: range.start, lt: range.end },
      },
      select: {
        id: true,
        // `leadId` se pide aquí para NO tener que volver a consultar las
        // mismas visitas solo para saber qué prospectos llegaron a agendar.
        leadId: true,
        scheduledAt: true,
        status: true,
        feedback: true,
        user: { select: { firstName: true, lastName: true } },
        lead: { select: { contact: { select: { name: true } } } },
      },
      orderBy: { scheduledAt: "desc" },
    }),
    prisma.realtyDeal.findMany({
      where: {
        accountId: ctx.accountId,
        propertyId: property.id,
        // 🔴 EL RECORTE AL PERIODO, y por qué cada mitad es distinta.
        //
        // Sin él, un inmueble vendido hace tres años entraba a CUALQUIER
        // reporte y la recomendación arrancaba con "La operación se cerró
        // EN EL PERIODO", que es sencillamente falso — y es la primera
        // frase que lee el propietario.
        //
        //   · CERRADO   → tiene que haber cerrado DENTRO del periodo. Un
        //     cierre viejo es historia, no actividad de estos días.
        //   · EN_PROCESO → basta con que ya existiera al terminar el
        //     periodo. Una oferta hecha el mes pasado que SIGUE sobre la
        //     mesa es justo lo que el propietario necesita saber;
        //     esconderla por no haber nacido dentro del rango sería
        //     ocultarle una oferta viva.
        OR: [
          { status: "CERRADO", closedAt: { gte: range.start, lt: range.end } },
          { status: "EN_PROCESO", createdAt: { lt: range.end } },
        ],
      },
      select: { id: true, status: true, amount: true, closedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // ── Portales: publicación real + interés que trajo cada uno ──
  const leadsByPortal = new Map<string, { leads: number; visits: number; offers: number }>();
  const bump = (key: string, field: "leads" | "visits" | "offers") => {
    const slot = leadsByPortal.get(key) ?? { leads: 0, visits: 0, offers: 0 };
    slot[field] += 1;
    leadsByPortal.set(key, slot);
  };

  // La visita no guarda portal: se lo pregunta a su prospecto, y por eso
  // hace falta el conjunto de prospectos que SÍ llegaron a agendar. Sale de
  // las visitas que ya se trajeron arriba —mismo filtro, mismas filas— y no
  // de una segunda consulta idéntica.
  const leadIdsWithVisit = new Set<string>(
    visits.map((v) => v.leadId).filter((id): id is string => typeof id === "string"),
  );

  let calls = 0;
  let messages = 0;
  const responseMinutes: number[] = [];
  let unanswered = 0;
  const OFFER_STAGES: RealtyLeadStage[] = ["OFERTA", "CIERRE"];

  for (const l of leads) {
    // El origen vive en DOS lados: `portal` del prospecto (lo pone la captura
    // por correo y la web) y `source` del contacto (lo pone quien lo dio de
    // alta a mano). Sin este COALESCE, los prospectos capturados desde el
    // panel desaparecen del reporte en silencio.
    const key = normalizePortalKey(l.portal, l.contact?.source ?? null);
    bump(key, "leads");
    if (leadIdsWithVisit.has(l.id)) bump(key, "visits");
    if (OFFER_STAGES.includes(l.stage)) bump(key, "offers");

    for (const a of l.activities) {
      if (a.kind === "LLAMADA") calls += 1;
      else messages += 1;
    }

    if (l.firstResponseAt) {
      const mins = Math.round((l.firstResponseAt.getTime() - l.createdAt.getTime()) / 60_000);
      responseMinutes.push(Math.max(0, mins));
    } else {
      unanswered += 1;
    }
  }

  const portals: OwnerReportPortalLine[] = [];
  const seenPortals = new Set<string>();
  for (const li of listings) {
    seenPortals.add(li.portal);
    const stats = leadsByPortal.get(li.portal) ?? { leads: 0, visits: 0, offers: 0 };
    portals.push({
      portal: li.portal,
      label: portalLabel(li.portal),
      published: li.status === "PUBLICADO",
      status: String(li.status),
      lastPushedAt: li.lastPushedAt ? li.lastPushedAt.toISOString() : null,
      leads: stats.leads,
      visits: stats.visits,
      offers: stats.offers,
    });
  }
  // Un portal que trajo gente pero del que no hay fila de publicación (por
  // ejemplo, un correo de Vivanuncios sin feed dado de alta) también cuenta:
  // esconderlo dejaría fuera prospectos reales.
  for (const [key, stats] of Array.from(leadsByPortal.entries())) {
    if (seenPortals.has(key)) continue;
    portals.push({
      portal: key,
      label: portalLabel(key),
      published: false,
      status: null,
      lastPushedAt: null,
      leads: stats.leads,
      visits: stats.visits,
      offers: stats.offers,
    });
  }
  portals.sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label, "es-MX"));

  // ── Visitas y lo que dijeron ──
  const visitLines: OwnerReportVisitLine[] = visits.map((v) => {
    // 🔴 UN SOLO LUGAR lee la opinión de una visita: `readVisitFeedback`.
    // Es la costura con O2-T3 — cuando aterrice su retroalimentación
    // estructurada se cambia esa función y ni esta consulta, ni el PDF, ni
    // la hoja de cálculo, ni la recomendación se enteran. Ver su cabecera.
    const fb = readVisitFeedback(v);
    return {
      id: v.id,
      scheduledAt: v.scheduledAt.toISOString(),
      status: v.status,
      happened: visitHappened(v.status, v.scheduledAt, now),
      agentName: v.user ? `${v.user.firstName ?? ""} ${v.user.lastName ?? ""}`.trim() || null : null,
      visitorName: v.lead?.contact?.name ?? null,
      feedback: fb.text,
      priceObjection: fb.priceObjection,
      liked: fb.liked,
    };
  });

  const visitsHappened = visitLines.filter((v) => v.happened).length;
  const visitsCancelled = visitLines.filter((v) => v.status === "CANCELADA").length;
  const visitsNoShow = visitLines.filter((v) => v.status === "NO_ASISTIO").length;
  const feedbackCount = visitLines.filter((v) => hasFeedback(v.feedback)).length;
  const priceObjections = visitLines.filter((v) => v.priceObjection).length;
  const likedCount = visitLines.filter((v) => v.liked).length;

  // ── Ofertas: las etapas OFERTA del CRM y las operaciones EN_PROCESO ──
  const offers: OwnerReportOfferLine[] = [];
  for (const l of leads) {
    if (l.stage !== "OFERTA") continue;
    offers.push({
      id: l.id,
      kind: "LEAD",
      who: l.contact?.name ?? "Sin nombre",
      when: l.createdAt.toISOString(),
      // Una etapa OFERTA no guarda importe en ningún lado: no hay tabla de
      // ofertas. Se enseña la oferta, no un monto inventado.
      amountCents: null,
      currency: null,
      status: REALTY_LEAD_STAGE_UI.OFERTA.label,
    });
  }
  let closedDeal: OwnerReportOfferLine | null = null;
  for (const d of deals) {
    const line: OwnerReportOfferLine = {
      id: d.id,
      kind: "DEAL",
      who: "Operación registrada",
      when: (d.closedAt ?? d.createdAt).toISOString(),
      amountCents: toCents(d.amount),
      currency,
      status: d.status === "CERRADO" ? "Cerrada" : "En proceso",
    };
    if (d.status === "CERRADO") {
      if (!closedDeal) closedDeal = line;
    } else {
      offers.push(line);
    }
  }

  const zone = await buildZoneComparables(ctx, property, currency, now);

  const response: OwnerReportResponse = {
    answered: responseMinutes.length,
    unanswered,
    avgMinutes:
      responseMinutes.length > 0
        ? Math.round(responseMinutes.reduce((a, b) => a + b, 0) / responseMinutes.length)
        : null,
    medianMinutes: medianOf(responseMinutes),
  };

  const portalsPublished = portals.filter((p) => p.published).length;
  const webPublished = property.isPublished === true;

  const recommendation = buildOwnerRecommendation({
    days: range.days,
    isPublished: property.isPublished === true,
    portalsPublished,
    webPublished,
    leads: leads.length,
    visitsHappened,
    visitsScheduled: visitLines.length,
    feedbackCount,
    priceObjections,
    likedCount,
    offers: offers.length,
    closed: closedDeal !== null,
    response,
    zone,
    operation: String(property.operation),
  });

  return {
    propertyId: property.id,
    propertyTitle: property.title,
    propertyKind: property.kind as RealtyPropertyKind,
    address: property.address ?? null,
    ownerId: property.owner?.id ?? null,
    ownerName: property.owner?.name ?? null,
    currency,
    askingPriceCents: toCents(property.price),
    operation: String(property.operation),
    status: String(property.status),

    from: range.from,
    to: range.to,
    days: range.days,

    isPublished: property.isPublished === true,
    webPublished,
    portals,

    leads: leads.length,
    calls,
    messages,
    response,

    visitsScheduled: visitLines.length,
    visitsHappened,
    visitsCancelled,
    visitsNoShow,
    visits: visitLines,
    feedbackCount,
    priceObjections,
    likedCount,

    offers,
    closedDeal,
    zone,
    recommendation,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Lo que se está CERRANDO en la zona: operaciones reales de la propia
 * cuenta, mismo tipo de inmueble, misma ciudad y misma moneda, en los
 * últimos 12 meses.
 *
 * Si no hay al menos tres comparables no se emite nada: con una o dos
 * operaciones, la "mediana de la zona" es la anécdota de una casa y
 * sostener una baja de precio con eso sería irresponsable.
 */
async function buildZoneComparables(
  ctx: RealtyContext,
  property: { id: string; kind: unknown; city: string | null; colonia: string | null; price: unknown },
  currency: RealtyCurrency,
  now: Date,
): Promise<OwnerReportZone | null> {
  if (!property.city) return null;
  const scope = await nestedPropertyScope(ctx);
  const since = new Date(now.getTime() - 365 * 86_400_000);

  const rows = await prisma.realtyDeal.findMany({
    where: {
      accountId: ctx.accountId,
      status: "CERRADO",
      closedAt: { gte: since, lte: now },
      propertyId: { not: property.id },
      property: {
        ...scope,
        city: property.city,
        kind: property.kind as RealtyPropertyKind,
        currency,
      },
    },
    select: { amount: true },
  });

  const amounts = rows.map((r) => toCents(r.amount)).filter((c) => c > 0);
  if (amounts.length < ZONE_MIN_COMPARABLES) return null;

  const median = medianOf(amounts);
  if (median === null || median <= 0) return null;

  const asking = toCents(property.price);
  return {
    city: property.city,
    colonia: property.colonia ?? null,
    kind: property.kind as RealtyPropertyKind,
    currency,
    closedCount: amounts.length,
    medianClosedCents: median,
    deltaPct: priceDeltaPct(asking, median),
  };
}

/** El origen del prospecto, con el COALESCE de los dos vocabularios. */
function normalizePortalKey(portal: string | null, source: string | null): string {
  const raw = (portal ?? source ?? "").trim();
  if (!raw) return "sin-origen";
  return raw.replace(/^portal:/, "").toLowerCase();
}

const PORTAL_LABELS: Record<string, string> = {
  inmuebles24: "Inmuebles24",
  lamudi: "Lamudi",
  vivanuncios: "Vivanuncios",
  mercadolibre: "Mercado Libre",
  casasyterrenos: "Casas y Terrenos",
  propiedades: "Propiedades.com",
  trovit: "Trovit",
  mitula: "Mitula",
  nuroa: "Nuroa",
  nestoria: "Nestoria",
  icasas: "iCasas",
  beleta: "Beleta",
  clasco: "Clasco",
  meta: "Facebook e Instagram",
  "web-propia": "Tu propia web",
  propio: "Tu propia web",
  web: "Tu propia web",
  letrero: "Letrero en la calle",
  calculadora: "Calculadora pública",
  manual: "Alta a mano",
  generico: "Otro portal",
  otro: "Otro portal",
  "sin-origen": "Sin origen registrado",
};

export function portalLabel(key: string): string {
  const clean = (key ?? "").replace(/^portal:/, "").toLowerCase();
  return PORTAL_LABELS[clean] ?? clean.charAt(0).toUpperCase() + clean.slice(1);
}

// ═══════════════════════════════════════════════════════════════════════
// 4. B y D · CARTERA Y RENTABILIDAD POR INMUEBLE
// ═══════════════════════════════════════════════════════════════════════

export interface PropertyEconomics {
  propertyId: string;
  title: string;
  kind: RealtyPropertyKind;
  operation: string;
  status: string;
  city: string | null;
  ownerId: string | null;
  ownerName: string | null;
  currency: RealtyCurrency;
  /** Precio de LISTA. No es un avalúo: el sistema no tiene valuaciones. */
  valueCents: number;
  /** Renta mensual del contrato vigente; si no hay, el precio de renta. */
  monthlyRentCents: number;
  monthlyRentCurrency: RealtyCurrency;
  hasActiveLease: boolean;
  income: MoneyByCurrency;
  expenses: MoneyByCurrency;
  expensesByKind: Record<string, MoneyByCurrency>;
  /** Informativo: NO se resta (ver la nota de doble conteo). */
  maintenanceCost: MoneyByCurrency;
  net: MoneyByCurrency;
  monthsVacant: number;
  monthsInRange: number;
  yield: YieldResult;
}

export interface PortfolioReport {
  from: string;
  to: string;
  months: number;
  rows: PropertyEconomics[];
  totalValue: MoneyByCurrency;
  totalMonthlyRent: MoneyByCurrency;
  totalIncome: MoneyByCurrency;
  totalExpenses: MoneyByCurrency;
  totalNet: MoneyByCurrency;
  /** Rendimiento del conjunto, POR MONEDA. Nunca uno solo si hay dos. */
  yieldByCurrency: Array<{ currency: RealtyCurrency; netPct: number | null; grossPct: number | null }>;
  best: PropertyEconomics | null;
  worst: PropertyEconomics | null;
  ownerId: string | null;
  ownerName: string | null;
  /** Pagos que no cuelgan de ningún inmueble: no entran en los totales. */
  orphanPayments: number;
  generatedAt: string;
}

/**
 * La economía de cada inmueble en el periodo. Es el insumo de la cartera
 * del propietario (B) y de la rentabilidad por inmueble (D): las dos
 * pantallas son la MISMA cuenta presentada distinto, así que comparten
 * consulta y no pueden discrepar.
 */
export async function getPropertyEconomics(
  ctx: RealtyContext,
  args: { from?: string | null; to?: string | null; ownerId?: string | null },
  now: Date = new Date(),
): Promise<PortfolioReport> {
  const range = resolveRange(ctx, args.from, args.to, now);
  const scope = await propertyScopeWhere(ctx);
  const where: Prisma.RealtyPropertyWhereInput = args.ownerId
    ? { ...scope, ownerId: args.ownerId }
    : scope;

  const [properties, payments, expenses, maintenances, leases] = await Promise.all([
    prisma.realtyProperty.findMany({
      where,
      select: { ...PROPERTY_MINI, owner: { select: { id: true, name: true } } },
      orderBy: { title: "asc" },
    }),
    loadPayments(ctx, range),
    prisma.realtyExpense.findMany({
      where: {
        accountId: ctx.accountId,
        paidAt: { gte: range.start, lt: range.end },
        property: args.ownerId
          ? { ...(await nestedPropertyScope(ctx)), ownerId: args.ownerId }
          : await nestedPropertyScope(ctx),
      },
      select: {
        propertyId: true,
        kind: true,
        amount: true,
        paidAt: true,
        property: { select: { currency: true } },
      },
    }),
    prisma.realtyMaintenance.findMany({
      where: {
        accountId: ctx.accountId,
        createdAt: { gte: range.start, lt: range.end },
        cost: { not: null },
        property: args.ownerId
          ? { ...(await nestedPropertyScope(ctx)), ownerId: args.ownerId }
          : await nestedPropertyScope(ctx),
      },
      select: { propertyId: true, cost: true, property: { select: { currency: true } } },
    }),
    prisma.realtyLease.findMany({
      where: {
        accountId: ctx.accountId,
        property: args.ownerId
          ? { ...(await nestedPropertyScope(ctx)), ownerId: args.ownerId }
          : await nestedPropertyScope(ctx),
        // Contratos que se solapan con el periodo, para medir meses vacía.
        startsAt: { lt: range.end },
        endsAt: { gte: range.start },
      },
      select: {
        propertyId: true,
        startsAt: true,
        endsAt: true,
        rentAmount: true,
        currency: true,
        status: true,
      },
    }),
  ]);

  const byProperty = new Map<string, PropertyEconomics>();
  for (const p of properties) {
    const currency = asCurrency(p.currency);
    byProperty.set(p.id, {
      propertyId: p.id,
      title: p.title,
      kind: p.kind as RealtyPropertyKind,
      operation: String(p.operation),
      status: String(p.status),
      city: p.city ?? null,
      ownerId: p.owner?.id ?? null,
      ownerName: p.owner?.name ?? null,
      currency,
      valueCents: toCents(p.price),
      monthlyRentCents: toCents(p.rentPrice),
      monthlyRentCurrency: currency,
      hasActiveLease: false,
      income: emptyMoney(),
      expenses: emptyMoney(),
      expensesByKind: {},
      maintenanceCost: emptyMoney(),
      net: emptyMoney(),
      monthsVacant: range.months,
      monthsInRange: range.months,
      yield: computeYield({
        currency,
        valueCents: toCents(p.price),
        income: emptyMoney(),
        expenses: emptyMoney(),
        months: range.months,
      }),
    });
  }

  // ── Ingresos. Solo el dinero de RENTA cuenta como ingreso del inmueble:
  //    una comisión cobrada por una venta es ingreso de la inmobiliaria,
  //    no del propietario, y mezclarlas inflaría el rendimiento. ──
  for (const pay of payments.rows) {
    if (!pay.property) continue;
    const row = byProperty.get(pay.property.id);
    if (!row || !pay.isRent) continue;
    addCents(row.income, pay.currency, pay.cents);
  }

  // ── Gastos. Heredan la moneda del INMUEBLE (RealtyExpense no la guarda). ──
  for (const e of expenses) {
    const row = byProperty.get(e.propertyId);
    if (!row) continue;
    const cur = asCurrency(e.property?.currency);
    addAmount(row.expenses, cur, e.amount);
    const key = String(e.kind);
    if (!row.expensesByKind[key]) row.expensesByKind[key] = emptyMoney();
    addAmount(row.expensesByKind[key], cur, e.amount);
  }

  // ── Mantenimiento: se ENSEÑA, no se resta. ──────────────────────────
  // 🔴 Cuando la inmobiliaria paga una reparación, la captura como gasto
  // (kind REPARACION o MANTENIMIENTO) — el propio flujo de resolver un
  // mantenimiento con costo ofrece crear el gasto. Restar además el `cost`
  // le cobraría al propietario dos veces la misma plomería. Misma regla que
  // el estado de cuenta del portal del propietario.
  for (const m of maintenances) {
    const row = byProperty.get(m.propertyId);
    if (!row) continue;
    addAmount(row.maintenanceCost, asCurrency(m.property?.currency), m.cost);
  }

  // ── Renta mensual vigente y meses vacía ──
  const coverage = new Map<string, Set<string>>();
  for (const l of leases) {
    const row = byProperty.get(l.propertyId);
    if (!row) continue;
    if (l.status === "ACTIVO") {
      row.hasActiveLease = true;
      row.monthlyRentCents = toCents(l.rentAmount);
      row.monthlyRentCurrency = asCurrency(l.currency);
    }
    if (l.status === "BORRADOR") continue;
    const set = coverage.get(l.propertyId) ?? new Set<string>();
    // Meses cubiertos por el contrato DENTRO del rango.
    const cursorStart = l.startsAt > range.start ? l.startsAt : range.start;
    const cursorEnd = l.endsAt < range.end ? l.endsAt : range.end;

    // 🔴 EL CURSOR ARRANCA EL DÍA 1 DEL MES, no el día del contrato.
    //
    // `setUTCMonth(+1)` sobre un día 29, 30 o 31 DESBORDA: el 31 de enero
    // más un mes es el 3 de marzo, no el 28 de febrero. Con el cursor en el
    // día del contrato, un arrendamiento firmado un día 31 se saltaba
    // febrero entero y el inmueble aparecía con un mes VACÍO de más — en la
    // pantalla que le dice al rentista cuántos meses no le rindió su casa.
    // Con el cursor siempre en día 1 no hay mes que desborde.
    const cur = new Date(
      Date.UTC(cursorStart.getUTCFullYear(), cursorStart.getUTCMonth(), 1),
    );
    let guard = 0;
    while (cur.getTime() <= cursorEnd.getTime() && guard < 400) {
      set.add(monthKey(cur));
      cur.setUTCMonth(cur.getUTCMonth() + 1);
      guard += 1;
    }
    coverage.set(l.propertyId, set);
  }
  for (const row of Array.from(byProperty.values())) {
    const covered = coverage.get(row.propertyId)?.size ?? 0;
    row.monthsVacant = Math.max(0, range.months - covered);
    row.net = {
      MXN: row.income.MXN - row.expenses.MXN,
      USD: row.income.USD - row.expenses.USD,
    };
    row.yield = computeYield({
      currency: row.currency,
      valueCents: row.valueCents,
      income: row.income,
      expenses: row.expenses,
      months: range.months,
    });
  }

  const rows = Array.from(byProperty.values());
  const totalValue = emptyMoney();
  const totalMonthlyRent = emptyMoney();
  let totalIncome = emptyMoney();
  let totalExpenses = emptyMoney();
  for (const r of rows) {
    addCents(totalValue, r.currency, r.valueCents);
    addCents(totalMonthlyRent, r.monthlyRentCurrency, r.monthlyRentCents);
    totalIncome = mergeMoney(totalIncome, r.income);
    totalExpenses = mergeMoney(totalExpenses, r.expenses);
  }
  const totalNet = {
    MXN: totalIncome.MXN - totalExpenses.MXN,
    USD: totalIncome.USD - totalExpenses.USD,
  };

  // Rendimiento del conjunto: UNO POR MONEDA. Un solo porcentaje que
  // mezclara pesos y dólares no significaría nada.
  const currencies = Array.from(
    new Set(
      activeCurrencies(totalValue)
        .concat(activeCurrencies(totalIncome))
        .concat(activeCurrencies(totalExpenses)),
    ),
  );
  const yieldByCurrency = currencies.map((c) => {
    const one = computeYield({
      currency: c,
      valueCents: totalValue[c],
      income: { MXN: c === "MXN" ? totalIncome.MXN : 0, USD: c === "USD" ? totalIncome.USD : 0 },
      expenses: {
        MXN: c === "MXN" ? totalExpenses.MXN : 0,
        USD: c === "USD" ? totalExpenses.USD : 0,
      },
      months: range.months,
    });
    return { currency: c, netPct: one.netPct, grossPct: one.grossPct };
  });

  // Mejor y peor: solo entre los que SÍ tienen un rendimiento emitible, y
  // solo si comparten moneda. Comparar un 8 % en dólares con un 6 % en
  // pesos como si fueran lo mismo es la trampa que este reporte evita.
  const rankable = rows.filter((r) => r.yield.netPct !== null);
  const sameCurrency = new Set(rankable.map((r) => r.currency)).size === 1;
  const sorted = rankable.slice().sort((a, b) => (b.yield.netPct ?? 0) - (a.yield.netPct ?? 0));
  const best = sameCurrency && sorted.length > 0 ? sorted[0] : null;
  const worst = sameCurrency && sorted.length > 1 ? sorted[sorted.length - 1] : null;

  const owner = args.ownerId
    ? rows.find((r) => r.ownerId === args.ownerId) ?? null
    : null;

  return {
    from: range.from,
    to: range.to,
    months: range.months,
    rows,
    totalValue,
    totalMonthlyRent,
    totalIncome,
    totalExpenses,
    totalNet,
    yieldByCurrency,
    best,
    worst,
    ownerId: args.ownerId ?? null,
    ownerName: owner?.ownerName ?? null,
    orphanPayments: payments.orphans,
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5. C · RESUMEN ANUAL DEL ARRENDADOR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Categorías de gasto que en el arrendamiento suelen ser deducibles.
 *
 * 🔴 LEE ESTO ANTES DE TOCARLO: `RealtyExpense` NO tiene bandera de
 * deducible. Nadie marca un gasto como tal. Esta clasificación es POR
 * CATEGORÍA y es una ayuda para el contador, no un dictamen fiscal — la
 * pantalla y el PDF lo dicen con esas palabras. Quien decide qué se deduce
 * es el contador, con los comprobantes en la mano.
 */
const LIKELY_DEDUCTIBLE: RealtyExpenseKind[] = [
  "PREDIAL",
  "AGUA",
  "MANTENIMIENTO",
  "REPARACION",
];

export interface TaxSummaryProperty {
  propertyId: string;
  title: string;
  address: string | null;
  currency: RealtyCurrency;
  income: MoneyByCurrency;
  expenses: MoneyByCurrency;
  expensesByKind: Record<string, MoneyByCurrency>;
  likelyDeductible: MoneyByCurrency;
  notClassified: MoneyByCurrency;
  retained: MoneyByCurrency;
  commissionPct: number | null;
  net: MoneyByCurrency;
}

export interface TaxSummaryPayment {
  id: string;
  paidAt: string;
  propertyTitle: string;
  periodMonth: string | null;
  method: string;
  reference: string | null;
  receiptFolio: string;
  cents: number;
  currency: RealtyCurrency;
}

export interface TaxSummary {
  year: number;
  from: string;
  to: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerRfc: string | null;
  properties: TaxSummaryProperty[];
  payments: TaxSummaryPayment[];
  totalIncome: MoneyByCurrency;
  totalExpenses: MoneyByCurrency;
  totalLikelyDeductible: MoneyByCurrency;
  totalRetained: MoneyByCurrency;
  totalNet: MoneyByCurrency;
  /** Inmuebles sin comisión pactada: su retención es CERO, no un estimado. */
  withoutCommissionPct: number;
  orphanPayments: number;
  generatedAt: string;
}

/**
 * Lo que el arrendador le lleva a su contador: qué cobró, qué gastó, qué le
 * retuvo la inmobiliaria por administración y con qué fecha entró cada pago.
 *
 * 🔴 NO ES UNA DECLARACIÓN Y NO HAY CFDI. Este vertical no factura: no hay
 * timbrado, ni complemento de pago, ni retención fiscal. La palabra
 * "retenido" aquí significa la COMISIÓN DE ADMINISTRACIÓN que se quedó la
 * inmobiliaria, que sale del porcentaje pactado en la ficha del inmueble
 * (RealtyProperty.commissionPct). Si no hay porcentaje pactado, la
 * retención es CERO: inventar uno "de mercado" sería cobrarle al
 * propietario algo que nadie firmó.
 */
export async function getTaxSummary(
  ctx: RealtyContext,
  args: { year: number; ownerId?: string | null },
): Promise<TaxSummary> {
  const range = resolveYearRange(ctx, args.year);
  const nested = await nestedPropertyScope(ctx);
  const propWhere: Prisma.RealtyPropertyWhereInput = args.ownerId
    ? { ...nested, ownerId: args.ownerId }
    : nested;

  const [properties, payments, expenses, owner] = await Promise.all([
    prisma.realtyProperty.findMany({
      where: { accountId: ctx.accountId, ...propWhere },
      select: {
        id: true,
        title: true,
        address: true,
        currency: true,
        commissionPct: true,
        ownerId: true,
      },
      orderBy: { title: "asc" },
    }),
    loadPayments(ctx, range),
    prisma.realtyExpense.findMany({
      where: {
        accountId: ctx.accountId,
        paidAt: { gte: range.start, lt: range.end },
        property: propWhere,
      },
      select: {
        propertyId: true,
        kind: true,
        amount: true,
        property: { select: { currency: true } },
      },
    }),
    args.ownerId
      ? prisma.realtyPropertyOwner.findFirst({
          where: { id: args.ownerId, accountId: ctx.accountId },
          select: { id: true, name: true, rfc: true },
        })
      : Promise.resolve(null),
  ]);

  const rows = new Map<string, TaxSummaryProperty>();
  for (const p of properties) {
    const pct = p.commissionPct === null ? null : Number(p.commissionPct);
    rows.set(p.id, {
      propertyId: p.id,
      title: p.title,
      address: p.address ?? null,
      currency: asCurrency(p.currency),
      income: emptyMoney(),
      expenses: emptyMoney(),
      expensesByKind: {},
      likelyDeductible: emptyMoney(),
      notClassified: emptyMoney(),
      retained: emptyMoney(),
      commissionPct: Number.isFinite(pct as number) ? (pct as number) : null,
      net: emptyMoney(),
    });
  }

  const paymentLines: TaxSummaryPayment[] = [];
  for (const pay of payments.rows) {
    if (!pay.property || !pay.isRent) continue;
    const row = rows.get(pay.property.id);
    if (!row) continue;
    addCents(row.income, pay.currency, pay.cents);
    // La retención se calcula pago a pago y en centavos enteros, para que
    // la suma de las líneas cuadre con el total al centavo.
    if (row.commissionPct !== null && row.commissionPct > 0) {
      addCents(
        row.retained,
        pay.currency,
        Math.round((pay.cents * row.commissionPct) / 100),
      );
    }
    paymentLines.push({
      id: pay.id,
      paidAt: pay.paidAt.toISOString(),
      propertyTitle: pay.property.title,
      periodMonth: pay.periodMonth,
      method: pay.method,
      reference: pay.reference,
      receiptFolio: folioOf(pay.receiptUrl),
      cents: pay.cents,
      currency: pay.currency,
    });
  }

  for (const e of expenses) {
    const row = rows.get(e.propertyId);
    if (!row) continue;
    const cur = asCurrency(e.property?.currency);
    addAmount(row.expenses, cur, e.amount);
    const key = String(e.kind);
    if (!row.expensesByKind[key]) row.expensesByKind[key] = emptyMoney();
    addAmount(row.expensesByKind[key], cur, e.amount);
    if (LIKELY_DEDUCTIBLE.includes(e.kind as RealtyExpenseKind)) {
      addAmount(row.likelyDeductible, cur, e.amount);
    } else {
      addAmount(row.notClassified, cur, e.amount);
    }
  }

  let totalIncome = emptyMoney();
  let totalExpenses = emptyMoney();
  let totalLikelyDeductible = emptyMoney();
  let totalRetained = emptyMoney();
  let withoutCommissionPct = 0;

  const list = Array.from(rows.values());
  for (const r of list) {
    r.net = {
      MXN: r.income.MXN - r.expenses.MXN - r.retained.MXN,
      USD: r.income.USD - r.expenses.USD - r.retained.USD,
    };
    totalIncome = mergeMoney(totalIncome, r.income);
    totalExpenses = mergeMoney(totalExpenses, r.expenses);
    totalLikelyDeductible = mergeMoney(totalLikelyDeductible, r.likelyDeductible);
    totalRetained = mergeMoney(totalRetained, r.retained);
  }

  // Solo los inmuebles CON movimiento entran a la hoja: una lista de 200
  // inmuebles en ceros no le sirve a ningún contador.
  const conMovimiento = list.filter(
    (r) => activeCurrencies(r.income).length > 0 || activeCurrencies(r.expenses).length > 0,
  );

  // 🔴 El aviso se cuenta SOBRE LOS QUE SE VAN A PINTAR, no sobre la cartera
  // entera. Contándolos todos, un rentista con 3 casas rentadas y 40
  // publicadas leía "43 inmuebles no tienen comisión pactada" encima de una
  // tabla de TRES renglones — un número que no cuadra con nada de lo que
  // tiene enfrente y que le hace desconfiar del resto de la hoja.
  for (const r of conMovimiento) {
    if (r.commissionPct === null || r.commissionPct === 0) withoutCommissionPct += 1;
  }

  paymentLines.sort((a, b) => a.paidAt.localeCompare(b.paidAt));

  return {
    year: args.year,
    from: range.from,
    to: range.to,
    ownerId: args.ownerId ?? null,
    ownerName: owner?.name ?? null,
    ownerRfc: owner?.rfc ?? null,
    properties: conMovimiento,
    payments: paymentLines,
    totalIncome,
    totalExpenses,
    totalLikelyDeductible,
    totalRetained,
    totalNet: {
      MXN: totalIncome.MXN - totalExpenses.MXN - totalRetained.MXN,
      USD: totalIncome.USD - totalExpenses.USD - totalRetained.USD,
    },
    withoutCommissionPct,
    orphanPayments: payments.orphans,
    generatedAt: new Date().toISOString(),
  };
}

/** "REC-000123" a partir del receiptUrl; "" si todavía no se emitió. */
function folioOf(url: string | null): string {
  if (!url) return "";
  const m = /([A-Z]+-\d+)[^/]*$/.exec(url);
  return m ? m[1] : "";
}

// ═══════════════════════════════════════════════════════════════════════
// 6. E · REPORTES DE LA OPERACIÓN
// ═══════════════════════════════════════════════════════════════════════

export interface FunnelStep {
  stage: RealtyLeadStage;
  label: string;
  count: number;
  /** % respecto del escalón anterior. null en el primero. */
  fromPreviousPct: number | null;
}

export interface FunnelReport {
  /** Prospectos creados en el periodo. */
  total: number;
  steps: FunnelStep[];
  lost: number;
  lostReasons: Array<{ reason: string; label: string; count: number }>;
  /** Visitas REALES del periodo (la etapa se mueve, la visita queda). */
  visitsScheduled: number;
  visitsHappened: number;
  /** Operaciones cerradas del periodo. */
  closedDeals: number;
}

export interface PortalPerformanceRow {
  portal: string;
  label: string;
  leads: number;
  answered: number;
  visits: number;
  offers: number;
  closed: number;
  /** cerrados / prospectos × 100. Es la columna que decide el gasto. */
  closeRatePct: number;
  medianResponseMinutes: number | null;
}

export interface DelinquencyBucket {
  key: RealtyAgingKey;
  count: number;
  balance: MoneyByCurrency;
}

export interface DelinquencyRow {
  chargeId: string;
  leaseId: string;
  propertyId: string;
  propertyTitle: string;
  tenantName: string;
  periodMonth: string;
  dueAt: string;
  balanceCents: number;
  currency: RealtyCurrency;
  daysLate: number;
  aging: RealtyAgingKey;
}

export interface DelinquencyReport {
  today: string;
  overdue: MoneyByCurrency;
  overdueCount: number;
  buckets: DelinquencyBucket[];
  rows: DelinquencyRow[];
  /** Lo que se debería cobrar en los próximos 3 meses, mes por mes. */
  projection: Array<{ periodMonth: string; expected: MoneyByCurrency; charges: number }>;
}

export interface CommissionsReport {
  from: string;
  to: string;
  receipt: RealtyReceipt;
  /** Comisión de la casa, por moneda, de lo cerrado en el periodo. */
  houseCommission: MoneyByCurrency;
  closedVolume: MoneyByCurrency;
  closedDeals: number;
  /** Lo pagado en el periodo por fecha de PAGO (el corte de caja real). */
  paidInPeriod: MoneyByCurrency;
  /** true si hay operaciones en más de una moneda: el recibo no las separa. */
  mixedCurrency: boolean;
}

export interface OperationsReport {
  from: string;
  to: string;
  funnel: FunnelReport | null;
  portals: PortalPerformanceRow[];
  agents: RealtyAgentPerf[];
  delinquency: DelinquencyReport | null;
  commissions: CommissionsReport | null;
  generatedAt: string;
}

export async function getOperationsReport(
  ctx: RealtyContext,
  args: { from?: string | null; to?: string | null },
  now: Date = new Date(),
): Promise<OperationsReport> {
  const range = resolveRange(ctx, args.from, args.to, now);
  const access = getReportAccess(ctx);

  const [funnelAndPortals, delinquency, commissions] = await Promise.all([
    access.funnel ? buildFunnelAndPortals(ctx, range, now) : Promise.resolve(null),
    access.collections ? buildDelinquency(ctx, now) : Promise.resolve(null),
    access.commissions ? buildCommissions(ctx, range) : Promise.resolve(null),
  ]);

  return {
    from: range.from,
    to: range.to,
    funnel: funnelAndPortals?.funnel ?? null,
    portals: funnelAndPortals?.portals ?? [],
    agents: funnelAndPortals?.agents ?? [],
    delinquency,
    commissions,
    generatedAt: new Date().toISOString(),
  };
}

const FUNNEL_FLOW: RealtyLeadStage[] = [
  "NUEVO",
  "CONTACTADO",
  "CALIFICADO",
  "VISITA",
  "OFERTA",
  "CIERRE",
];

async function buildFunnelAndPortals(
  ctx: RealtyContext,
  range: ReportRange,
  now: Date,
): Promise<{ funnel: FunnelReport; portals: PortalPerformanceRow[]; agents: RealtyAgentPerf[] }> {
  const nested = await nestedPropertyScope(ctx);
  const manages = can(ctx, "leads.assign") || can(ctx, "team.manage") || ctx.role === "OWNER" || ctx.role === "MANAGER";

  // 🔴 Un asesor raso NO ve el embudo de sus compañeros. Sin este recorte,
  // cualquiera con leads.view se llevaría por esta puerta la cartera entera
  // y los tiempos de respuesta de todo el equipo. Mismo criterio que el
  // ranking de comisiones.
  const leadWhere: Prisma.RealtyLeadWhereInput = {
    accountId: ctx.accountId,
    createdAt: { gte: range.start, lt: range.end },
    OR: [{ property: nested }, { propertyId: null }],
    ...(manages ? {} : { assignedUserId: ctx.realtyUserId }),
  };

  const [leads, visits, closedDeals, users] = await Promise.all([
    prisma.realtyLead.findMany({
      where: leadWhere,
      select: {
        id: true,
        portal: true,
        stage: true,
        lostReason: true,
        createdAt: true,
        firstResponseAt: true,
        assignedUserId: true,
        contact: { select: { source: true } },
        visits: { select: { id: true } },
      },
    }),
    prisma.realtyVisit.findMany({
      where: {
        accountId: ctx.accountId,
        scheduledAt: { gte: range.start, lt: range.end },
        property: nested,
        ...(manages ? {} : { userId: ctx.realtyUserId }),
      },
      select: { id: true, status: true, scheduledAt: true },
    }),
    prisma.realtyDeal.findMany({
      where: {
        accountId: ctx.accountId,
        status: "CERRADO",
        closedAt: { gte: range.start, lt: range.end },
        property: nested,
      },
      select: { id: true, contactId: true },
    }),
    prisma.realtyUser.findMany({
      where: { accountId: ctx.accountId, ...(manages ? {} : { id: ctx.realtyUserId }) },
      select: { id: true, firstName: true, lastName: true, active: true },
    }),
  ]);

  // ── Embudo ──
  // La etapa es MUTABLE y el retroceso está permitido, así que contar por
  // `stage` da la FOTO de hoy, no la historia. Se cuenta acumulado: quien
  // está en OFERTA ya pasó por CONTACTADO. Es la lectura honesta de un campo
  // que no guarda su propio histórico.
  const stageIndex = (s: RealtyLeadStage) => FUNNEL_FLOW.indexOf(s);
  const steps: FunnelStep[] = [];
  let previous: number | null = null;
  for (const stage of FUNNEL_FLOW) {
    const idx = stageIndex(stage);
    const count = leads.filter((l) => {
      const li = stageIndex(l.stage);
      return li >= idx && li !== -1;
    }).length;
    steps.push({
      stage,
      label: REALTY_LEAD_STAGE_UI[stage].label,
      count,
      fromPreviousPct:
        previous === null ? null : previous > 0 ? Math.round((count / previous) * 1000) / 10 : 0,
    });
    previous = count;
  }

  const lostRows = leads.filter((l) => l.stage === "PERDIDO");
  const lostMap = new Map<string, number>();
  for (const l of lostRows) {
    const key = l.lostReason ?? "OTRO";
    lostMap.set(key, (lostMap.get(key) ?? 0) + 1);
  }

  const funnel: FunnelReport = {
    total: leads.length,
    steps,
    lost: lostRows.length,
    lostReasons: Array.from(lostMap.entries())
      .map(([reason, count]) => ({
        reason,
        label:
          (REALTY_LOST_REASON_LABELS as Record<string, string>)[reason] ?? reason,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    visitsScheduled: visits.length,
    visitsHappened: visits.filter((v) => visitHappened(v.status, v.scheduledAt, now)).length,
    closedDeals: closedDeals.length,
  };

  // ── Qué portal trae los que CIERRAN ──
  //
  // 🔴 RealtyDeal NO tiene leadId: el único puente con el prospecto es el
  // contacto. Por eso el "cerrado" de esta tabla se mide con la ETAPA CIERRE
  // del prospecto, que sí es un dato directo, y no repartiendo el importe de
  // las operaciones entre portales — un mismo contacto puede tener varios
  // prospectos de portales distintos y la atribución del dinero sería
  // adivinada. Aquí se cuentan personas, no pesos.
  const portalMap = new Map<
    string,
    { leads: number; answered: number; visits: number; offers: number; closed: number; mins: number[] }
  >();
  for (const l of leads) {
    const key = normalizePortalKey(l.portal, l.contact?.source ?? null);
    const slot =
      portalMap.get(key) ?? { leads: 0, answered: 0, visits: 0, offers: 0, closed: 0, mins: [] };
    slot.leads += 1;
    if (l.firstResponseAt) {
      slot.answered += 1;
      slot.mins.push(
        Math.max(0, Math.round((l.firstResponseAt.getTime() - l.createdAt.getTime()) / 60_000)),
      );
    }
    if (l.visits.length > 0) slot.visits += 1;
    if (l.stage === "OFERTA" || l.stage === "CIERRE") slot.offers += 1;
    if (l.stage === "CIERRE") slot.closed += 1;
    portalMap.set(key, slot);
  }

  const portals: PortalPerformanceRow[] = Array.from(portalMap.entries())
    .map(([portal, s]) => ({
      portal,
      label: portalLabel(portal),
      leads: s.leads,
      answered: s.answered,
      visits: s.visits,
      offers: s.offers,
      closed: s.closed,
      closeRatePct: s.leads > 0 ? Math.round((s.closed / s.leads) * 1000) / 10 : 0,
      medianResponseMinutes: medianOf(s.mins),
    }))
    // Se ordena por los que CIERRAN, no por los que más prospectos traen:
    // ese es el punto entero de este reporte.
    .sort((a, b) => b.closed - a.closed || b.closeRatePct - a.closeRatePct || b.leads - a.leads);

  // ── Tiempo de primera respuesta por asesor ──
  const perfInput = users.map((u) => {
    const mine = leads.filter((l) => l.assignedUserId === u.id);
    const mins: number[] = [];
    for (const l of mine) {
      if (!l.firstResponseAt) continue;
      mins.push(
        Math.max(0, Math.round((l.firstResponseAt.getTime() - l.createdAt.getTime()) / 60_000)),
      );
    }
    return {
      realtyUserId: u.id,
      name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Sin nombre",
      active: u.active,
      closedDeals: 0,
      closedVolume: 0,
      earnedCommission: 0,
      inProgressDeals: 0,
      inProgressCommission: 0,
      leads: mine.length,
      leadsWon: mine.filter((l) => l.stage === "CIERRE").length,
      responseMinutes: mins,
    };
  });
  const agents = buildRanking(perfInput).filter((a) => a.leads > 0);

  return { funnel, portals, agents };
}

/**
 * Morosidad con antigüedad de saldos y proyección de los próximos 3 meses.
 *
 * 🔴 Moroso NO es `status === "VENCIDO"`. Un cargo con abono parcial y
 * vencido se guarda como PARCIAL (el estado del abono gana sobre el del
 * calendario), así que contar por status dejaría fuera justo a los que
 * deben algo y ya se pasaron. El criterio es `saldo > 0 && días > 0`, que
 * es el mismo que usa el tablero de cobranza.
 *
 * Los cajones del semáforo son los del vertical (1-15 / 16-30 / +30), no
 * los clásicos 30/60/90: si el reporte hablara otro idioma que la pantalla
 * de cobranza, nadie sabría cuál de los dos creer.
 */
async function buildDelinquency(ctx: RealtyContext, now: Date): Promise<DelinquencyReport> {
  const tz = accountTimezone(ctx);
  const today = todayInTimezone(tz, now);
  const nested = await nestedPropertyScope(ctx);

  const charges = await prisma.realtyRentCharge.findMany({
    where: {
      accountId: ctx.accountId,
      status: { not: "PAGADO" },
      dueAt: { lt: today },
      lease: { property: nested },
    },
    select: {
      id: true,
      leaseId: true,
      periodMonth: true,
      dueAt: true,
      amount: true,
      lease: {
        select: {
          currency: true,
          property: { select: { id: true, title: true } },
          parties: {
            where: { role: "INQUILINO" },
            select: { contact: { select: { name: true } } },
            take: 1,
          },
        },
      },
      payments: { select: { amount: true } },
    },
    orderBy: { dueAt: "asc" },
  });

  const rows: DelinquencyRow[] = [];
  const overdue = emptyMoney();
  const bucketMap = new Map<RealtyAgingKey, { count: number; balance: MoneyByCurrency }>();

  for (const c of charges) {
    const paidCents = sumCentsBy(c.payments, (p) => p.amount);
    const bal = chargeBalance({
      amount: c.amount,
      paidCents,
      dueAt: c.dueAt,
      today,
    });
    if (bal.balanceCents <= 0 || bal.daysLate <= 0) continue;

    const currency = asCurrency(c.lease?.currency);
    const aging = agingBucket(bal.balanceCents, bal.daysLate);
    addCents(overdue, currency, bal.balanceCents);

    const slot = bucketMap.get(aging) ?? { count: 0, balance: emptyMoney() };
    slot.count += 1;
    addCents(slot.balance, currency, bal.balanceCents);
    bucketMap.set(aging, slot);

    rows.push({
      chargeId: c.id,
      leaseId: c.leaseId,
      propertyId: c.lease?.property?.id ?? "",
      propertyTitle: c.lease?.property?.title ?? "—",
      tenantName: c.lease?.parties?.[0]?.contact?.name ?? "—",
      periodMonth: c.periodMonth,
      dueAt: c.dueAt.toISOString(),
      balanceCents: bal.balanceCents,
      currency,
      daysLate: bal.daysLate,
      aging,
    });
  }

  rows.sort((a, b) => b.daysLate - a.daysLate);

  // ── Proyección de los 3 meses siguientes ──
  // Sale de los cargos que YA existen (el contrato los genera completos al
  // activarse), no de multiplicar la renta por tres: si a un contrato le
  // quedan dos meses, el tercero no debe aparecer como si fuera a cobrarse.
  // 🔴 El corte es el DÍA 1 del mes que está tres adelante, no "hoy + 3
  // meses". Dos razones, y las dos son visibles en pantalla:
  //   · `setUTCMonth(+3)` sobre un día 29, 30 o 31 DESBORDA: el 31 de enero
  //     más tres meses es el 1 de MAYO, así que la "proyección a 3 meses"
  //     amanecía con CUATRO renglones el último día del mes.
  //   · Agrupando por periodMonth, cortar en día 1 da exactamente los tres
  //     meses que promete el encabezado, cualquier día que se abra.
  // `Date.UTC` con el mes desbordado cruza bien el fin de año (nov + 3 = feb).
  const in3 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 3, 1));
  const future = await prisma.realtyRentCharge.findMany({
    where: {
      accountId: ctx.accountId,
      status: { not: "PAGADO" },
      dueAt: { gte: today, lt: in3 },
      lease: { property: nested },
    },
    select: {
      periodMonth: true,
      amount: true,
      lease: { select: { currency: true } },
      payments: { select: { amount: true } },
    },
  });

  const projMap = new Map<string, { expected: MoneyByCurrency; charges: number }>();
  for (const c of future) {
    const balance = Math.max(0, toCents(c.amount) - sumCentsBy(c.payments, (p) => p.amount));
    if (balance <= 0) continue;
    const slot = projMap.get(c.periodMonth) ?? { expected: emptyMoney(), charges: 0 };
    addCents(slot.expected, asCurrency(c.lease?.currency), balance);
    slot.charges += 1;
    projMap.set(c.periodMonth, slot);
  }

  return {
    today: today.toISOString().slice(0, 10),
    overdue,
    overdueCount: rows.length,
    buckets: (["D1_15", "D16_30", "D30_MAS"] as RealtyAgingKey[]).map((key) => ({
      key,
      count: bucketMap.get(key)?.count ?? 0,
      balance: bucketMap.get(key)?.balance ?? emptyMoney(),
    })),
    rows,
    projection: Array.from(projMap.entries())
      .map(([periodMonth, v]) => ({ periodMonth, expected: v.expected, charges: v.charges }))
      .sort((a, b) => a.periodMonth.localeCompare(b.periodMonth)),
  };
}

/**
 * Comisiones devengadas y pagadas del periodo.
 *
 * Se compone `periodRange` + consulta propia + `buildReceipt` (puro) en vez
 * de llamar a getDealsScreen: aquella trae plantillas, contactos y hasta 500
 * inmuebles que este reporte no pinta, y además lanza para un usuario sin
 * commissions.view — que por esta puerta sí puede llegar.
 */
async function buildCommissions(
  ctx: RealtyContext,
  range: ReportRange,
): Promise<CommissionsReport> {
  const nested = await nestedPropertyScope(ctx);
  const manages = can(ctx, "commissions.manage");

  // El periodo se ancla a la fecha de CIERRE de la operación, igual que el
  // recibo de T8: es cuando se devenga. Lo pagado dentro del rango se mide
  // aparte, por `paidAt`, porque son dos preguntas distintas ("cuánto se
  // ganó este mes" vs "cuánto salió de caja este mes").
  const where: Prisma.RealtyCommissionSplitWhereInput = {
    accountId: ctx.accountId,
    deal: {
      property: nested,
      closedAt: { gte: range.start, lt: range.end },
    },
    // Sin commissions.manage solo se ve la propia parte: el permiso de ver
    // comisiones no es el permiso de ver las de los demás.
    ...(manages ? {} : { realtyUserId: ctx.realtyUserId }),
  };

  const splits = await prisma.realtyCommissionSplit.findMany({
    where,
    select: {
      id: true,
      dealId: true,
      party: true,
      realtyUserId: true,
      externalName: true,
      pct: true,
      amount: true,
      paidAt: true,
      realtyUser: { select: { firstName: true, lastName: true } },
      deal: {
        select: {
          kind: true,
          status: true,
          closedAt: true,
          amount: true,
          commissionAmount: true,
          property: { select: { title: true, currency: true } },
        },
      },
    },
  });

  const rows: RealtyReceiptSplitRow[] = splits.map((s) => ({
    splitId: s.id,
    dealId: s.dealId,
    dealKind: s.deal.kind,
    dealStatus: s.deal.status,
    closedAt: s.deal.closedAt ? s.deal.closedAt.toISOString() : null,
    propertyTitle: s.deal.property?.title ?? null,
    party: s.party,
    realtyUserId: s.realtyUserId,
    beneficiary: s.realtyUser
      ? `${s.realtyUser.firstName ?? ""} ${s.realtyUser.lastName ?? ""}`.trim() || "Sin nombre"
      : s.externalName ?? "La oficina",
    pct: Number(s.pct),
    amount: s.amount,
    paidAt: s.paidAt ? s.paidAt.toISOString() : null,
  }));

  const receipt = buildReceipt(range.start.toISOString(), range.end.toISOString(), rows);

  // Los totales de dinero SÍ se separan por moneda, aunque el recibo (que es
  // de T8 y no la conoce) los agrupe solo por beneficiario. Por eso la
  // pantalla avisa cuando hay dos monedas: el recibo no las distingue.
  const houseCommission = emptyMoney();
  const closedVolume = emptyMoney();
  const paidInPeriod = emptyMoney();
  const dealsSeen = new Set<string>();
  const currenciesSeen = new Set<RealtyCurrency>();

  for (const s of splits) {
    const cur = asCurrency(s.deal.property?.currency);
    currenciesSeen.add(cur);
    if (s.paidAt && s.paidAt >= range.start && s.paidAt < range.end) {
      addAmount(paidInPeriod, cur, s.amount);
    }
    if (s.deal.status === "CERRADO" && !dealsSeen.has(s.dealId)) {
      dealsSeen.add(s.dealId);
      addAmount(closedVolume, cur, s.deal.amount);
      addAmount(houseCommission, cur, s.deal.commissionAmount);
    }
  }

  return {
    from: range.from,
    to: range.to,
    receipt,
    houseCommission,
    closedVolume,
    closedDeals: dealsSeen.size,
    paidInPeriod,
    mixedCurrency: currenciesSeen.size > 1,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 7. LISTAS PARA LOS SELECTORES DE LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

export interface ReportPickers {
  properties: Array<{ id: string; title: string; ownerId: string | null; currency: RealtyCurrency }>;
  owners: Array<{ id: string; name: string; properties: number }>;
  years: number[];
}

export async function getReportPickers(
  ctx: RealtyContext,
  now: Date = new Date(),
): Promise<ReportPickers> {
  const scope = await propertyScopeWhere(ctx);
  const [properties, owners] = await Promise.all([
    prisma.realtyProperty.findMany({
      where: scope,
      select: { id: true, title: true, ownerId: true, currency: true },
      orderBy: { title: "asc" },
      take: 500,
    }),
    prisma.realtyPropertyOwner.findMany({
      where: { accountId: ctx.accountId },
      select: { id: true, name: true, _count: { select: { properties: true } } },
      orderBy: { name: "asc" },
      take: 300,
    }),
  ]);

  const currentYear = Number(ymd(now, accountTimezone(ctx)).slice(0, 4));
  return {
    properties: properties.map((p) => ({
      id: p.id,
      title: p.title,
      ownerId: p.ownerId ?? null,
      currency: asCurrency(p.currency),
    })),
    owners: owners.map((o) => ({ id: o.id, name: o.name, properties: o._count.properties })),
    years: [currentYear, currentYear - 1, currentYear - 2],
  };
}

/** Centavos → número con dos decimales, para los DTO que van al navegador. */
export function toAmount(cents: number): number {
  return centsToNumber(cents);
}

// ═══════════════════════════════════════════════════════════════════════
// 8. LA LIGA QUE SE LE MANDA AL PROPIETARIO
// ═══════════════════════════════════════════════════════════════════════

/**
 * El reporte al propietario es lo ÚNICO del sistema que ve un cliente del
 * cliente, y ese señor NO tiene cuenta: no va a registrarse ni a teclear un
 * código para leer cómo va su casa. Necesita una liga que abra el PDF.
 *
 * ── POR QUÉ UN TOKEN FIRMADO Y NO UNA FILA EN LA BASE ──────────────────
 * Porque no puedo crear la tabla (el schema es de otra terminal) y porque
 * no hace falta: todo lo que la liga necesita saber cabe en el propio
 * token, y la firma HMAC es lo que impide fabricarse uno. Mismo mecanismo
 * que la cookie del portal (portal-core.ts), con las mismas tres reglas:
 *
 *   1. FALLA CERRADO EN PRODUCCIÓN. Sin secreto no se firma NI se acepta
 *      nada. Los helpers gemelos del repo caen a un literal que está en el
 *      repositorio; ese literal permitiría a cualquiera fabricarse una liga
 *      al reporte de cualquier inmueble. Aquí no.
 *   2. Comparación en tiempo constante (timingSafeEqual) y null ante
 *      CUALQUIER duda: firma que no cuadra, versión rara, caducada, un
 *      punto de más.
 *   3. CADUCA. Treinta días. Una liga eterna que se reenvía por WhatsApp
 *      acaba en un grupo familiar tres años después.
 *
 * ── LO QUE EL TOKEN NO LLEVA ───────────────────────────────────────────
 * NO lleva permisos ni el alcance de oficinas: lleva IDENTIDAD (quién la
 * emitió) y OBJETO (qué inmueble, qué periodo). El alcance se vuelve a
 * derivar de la base en cada petición, con el mismo `getOwnerActivityReport`
 * que usa la pantalla. Eso compra tres cosas:
 *   · si al asesor lo dan de baja, sus ligas mueren solas;
 *   · si el inmueble cambia de oficina y sale de su alcance, la liga deja
 *     de abrir — sin tener que ir a buscar y revocar ligas;
 *   · el propietario ve EXACTAMENTE el mismo reporte que el asesor, porque
 *     es la misma consulta y no una copia congelada.
 */
export const REPORT_LINK_DAYS = 30;

export interface ReportToken {
  /** Quién la emitió. De aquí sale el alcance, en cada petición. */
  realtyUserId: string;
  propertyId: string;
  from: string;
  to: string;
  expiresAt: Date;
}

/**
 * Llave de firma. Cascada declarada y MISMA que el portal del cliente, con
 * la misma diferencia importante respecto del resto del repo: en producción
 * devuelve null si no hay ninguna variable puesta.
 */
function reportSecret(): string | null {
  const fromEnv = process.env.COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return null;
  return "dalecontrol-realty-report-dev-only";
}

function signReport(payload: string): string | null {
  const secret = reportSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** ¿Es un id de los que genera Prisma (cuid) y no algo con puntos dentro? */
function safeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function safeYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Arma la liga. null cuando no se puede firmar (producción sin secreto) o
 * cuando alguno de los campos no tiene la forma esperada — que es lo mismo
 * que decir "no se emite una liga a medias".
 */
export function packReportToken(
  args: { realtyUserId: string; propertyId: string; from: string; to: string },
  now: Date = new Date(),
): { token: string; expiresAt: Date } | null {
  if (!safeId(args.realtyUserId) || !safeId(args.propertyId)) return null;
  if (!safeYmd(args.from) || !safeYmd(args.to)) return null;
  const expiresAt = new Date(now.getTime() + REPORT_LINK_DAYS * 86_400_000);
  const payload = `v1.${args.realtyUserId}.${args.propertyId}.${args.from}.${args.to}.${expiresAt.getTime()}`;
  const mac = signReport(payload);
  if (!mac) return null;
  return { token: `${payload}.${mac}`, expiresAt };
}

/** Lee y valida. Null ante cualquier duda. */
export function readReportToken(raw: string | null | undefined): ReportToken | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx < 1) return null;
  const payload = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = signReport(payload);
  if (!expected) return null;
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const parts = payload.split(".");
  // Exactamente seis campos. Un punto de más NO se interpreta "lo mejor
  // posible": se rechaza.
  if (parts.length !== 6) return null;
  const [version, realtyUserId, propertyId, from, to, expMs] = parts;
  if (version !== "v1") return null;
  if (!safeId(realtyUserId) || !safeId(propertyId)) return null;
  if (!safeYmd(from) || !safeYmd(to)) return null;
  const expiresAt = new Date(Number(expMs));
  if (!Number.isFinite(expiresAt.getTime())) return null;
  if (expiresAt.getTime() <= Date.now()) return null;
  return { realtyUserId, propertyId, from, to, expiresAt };
}

/**
 * Reconstruye el contexto del asesor que emitió la liga.
 *
 * 🔴 NO se fabrica un contexto con permisos de más: se relee el usuario de
 * la base tal cual, con su rol, su cuenta y su plan. Si lo dieron de baja
 * (`active: false`) o la cuenta se desactivó, devuelve null y la liga deja
 * de abrir — sin ninguna lista de revocación que mantener.
 */
export async function realtyContextForUser(
  realtyUserId: string,
): Promise<RealtyContext | null> {
  if (!safeId(realtyUserId)) return null;
  const ru = await prisma.realtyUser.findFirst({
    where: { id: realtyUserId, active: true },
    include: { account: true },
  });
  if (!ru || !ru.account.isActive) return null;
  const plan = await getRealtyPlan(ru.account.plan);
  return {
    realtyUserId: ru.id,
    accountId: ru.accountId,
    account: ru.account,
    mode: ru.account.mode,
    user: ru,
    role: ru.role,
    plan,
  };
}

/** El contexto de quien emitió la liga. Ver la nota de arriba. */
export async function contextFromReportToken(
  token: ReportToken,
): Promise<RealtyContext | null> {
  return realtyContextForUser(token.realtyUserId);
}

/** La liga completa, lista para pegar en un WhatsApp. */
export function reportPublicUrl(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/realty/reports/propietario/pdf?t=${encodeURIComponent(token)}`;
}

// ═══════════════════════════════════════════════════════════════════════
// 9. HOJA DE CÁLCULO — los cuatro reportes, exportables sin excepción
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los encabezados de las hojas van en ESPAÑOL literal, no por el
 * diccionario. Misma convención que `statementToCsv` de T4 y que el recibo:
 * el archivo se lo manda el asesor a su contador o a su propietario, gente
 * que no tiene cuenta ni idioma configurado en este sistema.
 *
 * 🔴 Y TODA columna de dinero va PARTIDA en dos —(MXN) y (USD)—, aunque el
 * inmueble solo tenga una. Es la regla de la pantalla llevada a Excel: con
 * una sola columna, el primer `=SUMA()` que alguien escriba produce
 * exactamente el número inventado que este módulo existe para evitar.
 */

/** Sí/no en una celda, sin depender de cómo Excel interprete TRUE. */
function siNo(v: boolean): string {
  return v ? "Sí" : "No";
}

// ── A · Reporte de actividad al propietario ────────────────────────────

export function ownerReportToCsv(report: OwnerActivityReport): string {
  const rec = report.recommendation;

  const lectura: Array<readonly unknown[]> = [
    ["Resumen", rec.headline],
    ["Lectura", rec.body],
  ];
  rec.actions.forEach((a, i) => lectura.push([`Qué hacer ${i + 1}`, a]));

  const blocks: CsvBlock[] = [
    {
      title: "La lectura",
      header: ["Concepto", "Texto"],
      rows: lectura,
    },
    {
      title: "Dónde está anunciado y qué trajo cada lado",
      header: [
        "Portal",
        "¿Publicado?",
        "Estado",
        "Última sincronización",
        "Personas que escribieron",
        "De esas, cuántas visitaron",
        "De esas, cuántas ofertaron",
      ],
      rows: report.portals.map((p) => [
        p.label,
        siNo(p.published),
        p.status ?? "",
        csvDate(p.lastPushedAt),
        p.leads,
        p.visits,
        p.offers,
      ]),
      emptyText:
        "El inmueble no aparece publicado en ningún portal ni en la web de la inmobiliaria.",
    },
    {
      title: "El interés",
      header: ["Concepto", "Valor"],
      rows: [
        ["Personas que preguntaron", report.leads],
        ["Llamadas registradas", report.calls],
        ["Mensajes registrados", report.messages],
        ["Primera respuesta (mediana, minutos)", report.response.medianMinutes ?? ""],
        ["Primera respuesta (promedio, minutos)", report.response.avgMinutes ?? ""],
        ["Personas sin respuesta", report.response.unanswered],
      ],
    },
    {
      title: "Visitas y qué opinaron",
      header: [
        "Fecha",
        "Quién",
        "Asesor",
        "Estado",
        "¿Ocurrió?",
        "¿Habló del precio?",
        "Comentario",
      ],
      rows: report.visits.map((v) => [
        csvDate(v.scheduledAt),
        v.visitorName ?? "",
        v.agentName ?? "",
        String(v.status),
        siNo(v.happened),
        siNo(v.priceObjection),
        v.feedback ?? "",
      ]),
      emptyText: "No hubo visitas agendadas en el periodo.",
    },
    {
      title: "Ofertas",
      header: [
        "Quién",
        "Cuándo",
        "Estado",
        ...csvMoneyHeaders("Monto"),
      ],
      rows: [...report.offers, ...(report.closedDeal ? [report.closedDeal] : [])].map((o) => {
        const money = emptyMoney();
        if (o.amountCents !== null && o.currency) addCents(money, o.currency, o.amountCents);
        return [o.who, csvDate(o.when), o.status, ...csvMoneyCells(money)];
      }),
      emptyText:
        "No se recibió ninguna oferta en el periodo. Una etapa OFERTA del CRM no guarda importe: por eso puede haber ofertas sin monto.",
    },
  ];

  if (report.zone) {
    blocks.push({
      title: "Lo que se está cerrando en la zona",
      header: ["Concepto", "Valor"],
      rows: [
        ["Operaciones comparables encontradas", report.zone.closedCount],
        [
          "Mediana de cierre",
          formatCents(report.zone.medianClosedCents, report.zone.currency),
        ],
        [
          "Este inmueble contra esa mediana",
          report.zone.deltaPct === null ? "" : `${report.zone.deltaPct} %`,
        ],
        [
          "Método",
          "Operaciones CERRADAS de esta misma inmobiliaria, del mismo tipo de inmueble, la misma ciudad y la misma moneda, en los últimos 12 meses. No es un índice de mercado.",
        ],
      ],
    });
  }

  return buildCsvReport(
    {
      title: `Reporte de actividad — ${report.propertyTitle}`,
      subtitle: `Del ${report.from} al ${report.to}`,
      currency: report.currency,
      meta: [
        ["Propietario", report.ownerName ?? "Sin propietario capturado"],
        ["Dirección", report.address ?? ""],
        ["Precio de lista", formatCents(report.askingPriceCents, report.currency)],
        ["Operación", report.operation],
        ["Generado", csvDate(report.generatedAt)],
        [
          "Aviso",
          "Este reporte NO dice cuántas veces se vio el anuncio: ningún portal nos devuelve ese contador. Lo que sí sabemos es cuánta gente escribió desde cada uno.",
        ],
      ],
    },
    blocks,
  );
}

// ── B y D · Cartera y rentabilidad ─────────────────────────────────────

export function portfolioToCsv(
  report: PortfolioReport,
  variant: "cartera" | "rentabilidad" = "cartera",
): string {
  const esCartera = variant === "cartera";

  const filas = report.rows.map((r) => [
    r.title,
    r.ownerName ?? "",
    r.city ?? "",
    r.currency,
    csvAmount(r.valueCents),
    csvAmount(r.monthlyRentCents),
    r.monthlyRentCurrency,
    ...csvMoneyCells(r.income),
    ...csvMoneyCells(r.expenses),
    ...csvMoneyCells(r.net),
    r.monthsVacant,
    r.yield.netPct === null ? "" : r.yield.netPct,
    r.yield.grossPct === null ? "" : r.yield.grossPct,
    yieldBlockedText(r.yield.blocked) ?? "",
  ]);

  const blocks: CsvBlock[] = [
    {
      title: "Inmueble por inmueble",
      header: [
        "Inmueble",
        "Propietario",
        "Ciudad",
        "Moneda del inmueble",
        "Valor (precio de lista)",
        "Renta mensual",
        "Moneda de la renta",
        ...csvMoneyHeaders("Ingresos"),
        ...csvMoneyHeaders("Gastos"),
        ...csvMoneyHeaders("Neto"),
        "Meses vacía",
        "Rendimiento neto anual (%)",
        "Rendimiento bruto anual (%)",
        "Por qué no hay rendimiento",
      ],
      rows: filas,
      footer: [
        "TOTAL",
        "",
        "",
        "",
        "",
        "",
        "",
        ...csvMoneyCells(report.totalIncome),
        ...csvMoneyCells(report.totalExpenses),
        ...csvMoneyCells(report.totalNet),
        "",
        "",
        "",
        "",
      ],
      emptyText: "No hay inmuebles en el alcance de este reporte.",
    },
    {
      title: "Rendimiento del conjunto, por moneda",
      header: ["Moneda", "Valor total", "Rendimiento neto anual (%)", "Rendimiento bruto anual (%)"],
      rows: report.yieldByCurrency.map((y) => [
        y.currency,
        csvAmount(report.totalValue[y.currency]),
        y.netPct === null ? "" : y.netPct,
        y.grossPct === null ? "" : y.grossPct,
      ]),
      emptyText: "No hay un rendimiento que emitir en el periodo.",
    },
  ];

  const conMantenimiento = report.rows.filter(
    (r) => r.maintenanceCost.MXN !== 0 || r.maintenanceCost.USD !== 0,
  );
  if (conMantenimiento.length > 0) {
    blocks.push({
      title: "Mantenimiento — INFORMATIVO, no se resta del neto",
      header: ["Inmueble", ...csvMoneyHeaders("Costo de mantenimiento")],
      rows: conMantenimiento.map((r) => [r.title, ...csvMoneyCells(r.maintenanceCost)]),
      footer: [
        "TOTAL",
        ...csvMoneyCells(
          sumMoneyList(conMantenimiento.map((r) => r.maintenanceCost)),
        ),
      ],
    });
  }

  const meta: Array<readonly [string, unknown]> = [
    ["Periodo", `Del ${report.from} al ${report.to} (${report.months} meses)`],
    ["Generado", csvDate(report.generatedAt)],
    [
      "El valor",
      "Es el PRECIO DE LISTA capturado en la ficha, no un avalúo: este sistema no hace valuaciones.",
    ],
    [
      "El rendimiento",
      "(ingresos − gastos) ÷ valor, anualizado por los meses del periodo. Solo se emite cuando el valor, los ingresos y los gastos están en la MISMA moneda.",
    ],
  ];
  if (report.ownerName) meta.unshift(["Propietario", report.ownerName]);
  if (report.orphanPayments > 0) {
    meta.push([
      "Pagos sin inmueble",
      `${report.orphanPayments} pago(s) no cuelgan de ningún inmueble y NO están en estos totales.`,
    ]);
  }

  return buildCsvReport(
    {
      title: esCartera ? "Cartera del propietario" : "Rentabilidad por inmueble",
      subtitle: esCartera
        ? "Cuánto vale, cuánto renta y cuánto deja de verdad."
        : "Ingresos menos gastos, inmueble por inmueble.",
      meta,
    },
    blocks,
  );
}

// ── C · Resumen anual del arrendador ───────────────────────────────────

export function taxSummaryToCsv(report: TaxSummary): string {
  const blocks: CsvBlock[] = [
    {
      title: "Por inmueble",
      header: [
        "Inmueble",
        "Dirección",
        "Moneda",
        ...csvMoneyHeaders("Ingresos"),
        ...csvMoneyHeaders("Gastos"),
        ...csvMoneyHeaders("Gastos probablemente deducibles"),
        ...csvMoneyHeaders("Gastos sin clasificar"),
        ...csvMoneyHeaders("Retenido por administración"),
        "Comisión pactada (%)",
        ...csvMoneyHeaders("Neto"),
      ],
      rows: report.properties.map((p) => [
        p.title,
        p.address ?? "",
        p.currency,
        ...csvMoneyCells(p.income),
        ...csvMoneyCells(p.expenses),
        ...csvMoneyCells(p.likelyDeductible),
        ...csvMoneyCells(p.notClassified),
        ...csvMoneyCells(p.retained),
        p.commissionPct === null ? "" : p.commissionPct,
        ...csvMoneyCells(p.net),
      ]),
      footer: [
        "TOTAL",
        "",
        "",
        ...csvMoneyCells(report.totalIncome),
        ...csvMoneyCells(report.totalExpenses),
        ...csvMoneyCells(report.totalLikelyDeductible),
        "",
        "",
        ...csvMoneyCells(report.totalRetained),
        "",
        ...csvMoneyCells(report.totalNet),
      ],
      emptyText: "No hubo ingresos ni gastos registrados en el año.",
    },
    {
      title: "Pagos recibidos, con su fecha",
      header: [
        "Fecha",
        "Inmueble",
        "Periodo",
        "Forma de pago",
        "Referencia",
        "Recibo",
        ...csvMoneyHeaders("Monto"),
      ],
      rows: report.payments.map((p) => {
        const money = emptyMoney();
        addCents(money, p.currency, p.cents);
        return [
          csvDate(p.paidAt),
          p.propertyTitle,
          p.periodMonth ?? "",
          p.method,
          p.reference ?? "",
          p.receiptFolio,
          ...csvMoneyCells(money),
        ];
      }),
      emptyText: "No se registró ningún pago de renta en el año.",
    },
  ];

  const meta: Array<readonly [string, unknown]> = [
    ["Periodo", `Del ${report.from} al ${report.to}`],
    [
      "Qué es esto",
      "Un resumen para tu contador. NO es una declaración y no la sustituye.",
    ],
    [
      "No hay CFDI",
      "Este sistema no factura, no timbra y no emite complementos de pago. Lo que aparece en la columna Recibo son RECIBOS internos, no comprobantes fiscales.",
    ],
    [
      "Qué significa Retenido",
      "La COMISIÓN DE ADMINISTRACIÓN que se quedó la inmobiliaria, calculada con el porcentaje pactado en la ficha del inmueble. NO es una retención de impuestos: nadie te retuvo ISR.",
    ],
    [
      "Gastos deducibles",
      "La columna 'probablemente deducibles' agrupa predial, agua, mantenimiento y reparaciones. Es una AYUDA por categoría, no un dictamen: quién decide qué se deduce es tu contador, con los comprobantes en la mano.",
    ],
    ["Generado", csvDate(report.generatedAt)],
  ];
  if (report.ownerName) meta.unshift(["Propietario", report.ownerName]);
  if (report.ownerRfc) meta.splice(1, 0, ["RFC", report.ownerRfc]);
  if (report.withoutCommissionPct > 0) {
    meta.push([
      "Inmuebles sin comisión pactada",
      `${report.withoutCommissionPct}. Su retención va en CERO porque nadie firmó un porcentaje, no porque se haya olvidado.`,
    ]);
  }
  if (report.orphanPayments > 0) {
    meta.push([
      "Pagos sin inmueble",
      `${report.orphanPayments} pago(s) no cuelgan de ningún inmueble y NO están en estos totales.`,
    ]);
  }

  return buildCsvReport(
    {
      title: `Resumen anual del arrendador — ${report.year}`,
      subtitle: "Llévale esto a tu contador.",
      meta,
    },
    blocks,
  );
}

// ── E · Reportes de la operación ───────────────────────────────────────

export function operationsToCsv(report: OperationsReport): string {
  const blocks: CsvBlock[] = [];

  if (report.funnel) {
    blocks.push({
      title: "Embudo de conversión",
      header: ["Etapa", "Cuántos", "% del escalón anterior"],
      rows: report.funnel.steps.map((s) => [
        s.label,
        s.count,
        s.fromPreviousPct === null ? "" : s.fromPreviousPct,
      ]),
      emptyText: "No entraron prospectos en el periodo.",
    });
    blocks.push({
      title: "Resumen del periodo",
      header: ["Concepto", "Valor"],
      rows: [
        ["Prospectos creados", report.funnel.total],
        ["Visitas agendadas", report.funnel.visitsScheduled],
        ["Visitas que ocurrieron", report.funnel.visitsHappened],
        ["Operaciones cerradas", report.funnel.closedDeals],
        ["Prospectos perdidos", report.funnel.lost],
        [
          "Método del embudo",
          "La etapa del prospecto es MUTABLE y no guarda histórico: se cuenta ACUMULADO (quien está en OFERTA ya pasó por CONTACTADO). Es la foto de hoy, no la historia.",
        ],
        [
          "Método de las visitas",
          "Una visita 'ocurrió' si ya pasó su hora y no se canceló ni faltó: hoy nada del sistema marca REALIZADA.",
        ],
      ],
    });
    if (report.funnel.lostReasons.length > 0) {
      blocks.push({
        title: "Por qué se perdieron",
        header: ["Motivo", "Cuántos"],
        rows: report.funnel.lostReasons.map((r) => [r.label, r.count]),
      });
    }
  }

  if (report.portals.length > 0) {
    blocks.push({
      title: "Qué portal trae los que CIERRAN",
      header: [
        "Portal",
        "Prospectos",
        "Contestados",
        "Visitaron",
        "Ofertaron",
        "Cerraron",
        "Tasa de cierre (%)",
        "Primera respuesta (mediana, minutos)",
      ],
      rows: report.portals.map((p) => [
        p.label,
        p.leads,
        p.answered,
        p.visits,
        p.offers,
        p.closed,
        p.closeRatePct,
        p.medianResponseMinutes ?? "",
      ]),
      footer: [
        "Método",
        "Se cuentan PERSONAS por la etapa CIERRE del prospecto, no pesos: una operación no guarda de qué prospecto vino, y repartir el importe entre portales sería adivinarlo.",
      ],
    });
  }

  if (report.agents.length > 0) {
    blocks.push({
      title: "Tiempo de primera respuesta por asesor",
      header: [
        "Asesor",
        "¿Activo?",
        "Prospectos",
        "Promedio (minutos)",
        "Mediana (minutos)",
        "Sin contestar",
        "Conversión (%)",
      ],
      rows: report.agents.map((a) => [
        a.name,
        siNo(a.active),
        a.leads,
        a.avgResponseMinutes ?? "",
        a.medianResponseMinutes ?? "",
        a.unanswered,
        a.conversionPct,
      ]),
    });
  }

  if (report.delinquency) {
    const d = report.delinquency;
    blocks.push({
      title: `Morosidad al ${d.today}`,
      header: [
        "Inmueble",
        "Inquilino",
        "Periodo",
        "Vence",
        "Días de retraso",
        "Antigüedad",
        ...csvMoneyHeaders("Saldo"),
      ],
      rows: d.rows.map((r) => {
        const money = emptyMoney();
        addCents(money, r.currency, r.balanceCents);
        return [
          r.propertyTitle,
          r.tenantName,
          r.periodMonth,
          csvDate(r.dueAt),
          r.daysLate,
          REALTY_AGING_UI[r.aging].label,
          ...csvMoneyCells(money),
        ];
      }),
      footer: ["TOTAL VENCIDO", "", "", "", "", "", ...csvMoneyCells(d.overdue)],
      emptyText: "No hay un solo peso vencido. Eso es una buena noticia.",
    });
    blocks.push({
      title: "Antigüedad de saldos",
      header: ["Cajón", "Cargos", ...csvMoneyHeaders("Saldo")],
      rows: d.buckets.map((b) => [
        REALTY_AGING_UI[b.key].label,
        b.count,
        ...csvMoneyCells(b.balance),
      ]),
    });
    blocks.push({
      title: "Proyección de cobranza — próximos 3 meses",
      header: ["Periodo", "Cargos", ...csvMoneyHeaders("Esperado")],
      rows: d.projection.map((p) => [p.periodMonth, p.charges, ...csvMoneyCells(p.expected)]),
      footer: [
        "Método",
        "Sale de los cargos que YA existen (el contrato los genera al activarse), no de multiplicar la renta por tres: a un contrato que se acaba en dos meses no se le inventa el tercero.",
      ],
      emptyText: "No hay cargos por vencer en los próximos tres meses.",
    });
  }

  if (report.commissions) {
    const c = report.commissions;
    blocks.push({
      title: "Comisiones devengadas y pagadas",
      header: [
        "Beneficiario",
        "Operaciones",
        "Devengado",
        "Pagado",
        "Pendiente",
        "En proceso (todavía no se gana)",
      ],
      rows: c.receipt.lines.map((l) => [
        l.beneficiary,
        l.operations,
        l.earned.toFixed(2),
        l.paid.toFixed(2),
        l.pending.toFixed(2),
        l.inProgress.toFixed(2),
      ]),
      footer: [
        "TOTAL",
        c.receipt.operations,
        c.receipt.totalEarned.toFixed(2),
        c.receipt.totalPaid.toFixed(2),
        c.receipt.totalPending.toFixed(2),
        c.receipt.totalInProgress.toFixed(2),
      ],
      emptyText: "No hubo comisiones devengadas en el periodo.",
    });
    blocks.push({
      title: "Comisiones — los totales SÍ separados por moneda",
      header: ["Concepto", ...csvMoneyHeaders("Importe")],
      rows: [
        ["Volumen cerrado", ...csvMoneyCells(c.closedVolume)],
        ["Comisión de la casa", ...csvMoneyCells(c.houseCommission)],
        ["Salió de caja en el periodo", ...csvMoneyCells(c.paidInPeriod)],
      ],
      footer: c.mixedCurrency
        ? [
            "Aviso",
            "Hay operaciones en pesos y en dólares. La tabla de beneficiarios de arriba NO las separa: sus columnas suman las dos monedas. Estas tres líneas sí las separan, y son las buenas.",
            "",
          ]
        : null,
    });
  }

  return buildCsvReport(
    {
      title: "Reportes de la operación",
      subtitle: `Del ${report.from} al ${report.to}`,
      meta: [["Generado", csvDate(report.generatedAt)]],
    },
    blocks.length > 0
      ? blocks
      : [
          {
            title: "Sin acceso",
            header: ["Aviso"],
            rows: [],
            emptyText:
              "Tu usuario no tiene permiso para ninguno de los bloques de este reporte, o tu plan no los incluye.",
          },
        ],
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 10. MANDARLE EL REPORTE AL PROPIETARIO
// ═══════════════════════════════════════════════════════════════════════

/**
 * ── POR QUÉ NO SE MANDA EL PDF COMO ADJUNTO ────────────────────────────
 * Porque el PDF se arma de la base EN EL MOMENTO en que se abre la liga.
 * Un adjunto es una foto congelada: si el asesor manda el reporte el lunes
 * y el martes se registra una visita, el propietario sigue viendo el lunes
 * y llama a preguntar por qué. Con la liga, el reporte que abre es el
 * mismo que ve el asesor en su pantalla, siempre.
 *
 * ── EL CANAL ───────────────────────────────────────────────────────────
 * WhatsApp SOLO dentro de la ventana de 24 h. No hay plantilla aprobada
 * para este reporte (las seis del vertical son de prospecto, visita y
 * cobranza) y Meta no deja escribir primero sin una. Cuando la ventana
 * está cerrada NO se finge un envío: se dice, y queda el correo o la liga
 * copiada a mano. Un botón que dice "enviado" y no envía enseña a la gente
 * a desconfiar del panel entero.
 */

export type OwnerReportChannel = "whatsapp" | "email";

export interface OwnerReportSendResult {
  ok: boolean;
  channel: OwnerReportChannel | null;
  /** Código, no texto: quien decide con esto no puede depender de la redacción. */
  reason:
    | "not_found"
    | "phone"
    | "plan"
    | "window"
    | "quota"
    | "not_connected"
    | "duplicate"
    | "no_link"
    | "email"
    | "meta"
    | null;
  /** Frase en español, lista para pintarse. */
  error: string | null;
  /** La liga firmada. Se devuelve AUNQUE el envío falle: es el plan B. */
  url: string | null;
  expiresAt: string | null;
}

/** El texto del mensaje. Español de México, corto, con la liga al final. */
export function ownerReportMessage(args: {
  ownerName: string | null;
  propertyTitle: string;
  accountName: string;
  headline: string;
  from: string;
  to: string;
  url: string;
}): string {
  const saludo = args.ownerName ? `Hola, ${firstName(args.ownerName)}.` : "Hola.";
  return [
    saludo,
    `Le comparto cómo va ${args.propertyTitle} del ${args.from} al ${args.to}.`,
    "",
    args.headline,
    "",
    `Aquí está el reporte completo: ${args.url}`,
    "",
    `— ${args.accountName}`,
  ].join("\n");
}

function firstName(full: string): string {
  const first = String(full).trim().split(/\s+/)[0] ?? "";
  return first || String(full).trim();
}

/**
 * UN CLIC: arma el reporte, firma la liga y la manda.
 *
 * `baseUrl` viene de quien llama (la ruta lo saca del request) porque en
 * este repo la URL pública no está garantizada en una env: `resolveRealtyBaseUrl`
 * cae al origin de la petición, y un cron no tiene petición (por eso el
 * barrido de abajo sí exige la variable y no manda nada sin ella).
 */
export async function sendOwnerReport(
  ctx: RealtyContext,
  args: {
    propertyId: string;
    from?: string | null;
    to?: string | null;
    baseUrl: string;
    /** Idempotencia del barrido automático. La pantalla no la manda. */
    claimKey?: string | null;
    /** Cuando WhatsApp no puede, ¿se intenta el correo? El barrido sí. */
    allowEmail?: boolean;
  },
  now: Date = new Date(),
): Promise<OwnerReportSendResult> {
  const report = await getOwnerActivityReport(
    ctx,
    { propertyId: args.propertyId, from: args.from, to: args.to },
    now,
  );
  if (!report) {
    return {
      ok: false,
      channel: null,
      reason: "not_found",
      error: "Ese inmueble ya no existe o no está en tu alcance.",
      url: null,
      expiresAt: null,
    };
  }

  const packed = packReportToken(
    {
      realtyUserId: ctx.realtyUserId,
      propertyId: report.propertyId,
      from: report.from,
      to: report.to,
    },
    now,
  );
  if (!packed) {
    // Producción sin COOKIE_SECRET: no se firma nada. Falla cerrado y se
    // dice, en vez de mandar una liga que no va a abrir.
    return {
      ok: false,
      channel: null,
      reason: "no_link",
      error: "No se pudo firmar la liga del reporte. Avísale a soporte.",
      url: null,
      expiresAt: null,
    };
  }
  const url = reportPublicUrl(args.baseUrl, packed.token);
  const expiresAt = packed.expiresAt.toISOString();

  const owner = report.ownerId
    ? await prisma.realtyPropertyOwner.findFirst({
        where: { id: report.ownerId, accountId: ctx.accountId },
        select: { name: true, phone: true, email: true },
      })
    : null;

  const body = ownerReportMessage({
    ownerName: owner?.name ?? report.ownerName,
    propertyTitle: report.propertyTitle,
    accountName: ctx.account.name,
    headline: report.recommendation.headline,
    from: report.from,
    to: report.to,
    url,
  });

  // ── WhatsApp ──
  // 🔴 El teléfono del PROPIETARIO se captura a mano ("33 1234 5678",
  // "+52 33…"), a diferencia del de un contacto. Sin mxTenDigits, media
  // lista de propietarios no recibiría nada y nadie sabría por qué.
  const phone = owner?.phone ? mxTenDigits(owner.phone) : null;
  let waError: OwnerReportSendResult | null = null;

  if (phone && ctx.plan.features.whatsapp === true) {
    try {
      const { sendRealtyWhatsApp } = await import("@/lib/realty/whatsapp");
      const res = await sendRealtyWhatsApp({
        accountId: ctx.accountId,
        phone,
        body,
        // Sin plantilla A PROPÓSITO: no existe una aprobada para este
        // reporte. Fuera de la ventana devuelve reason "window" y aquí se
        // dice tal cual, en vez de fingir un envío.
        kind: null,
        params: null,
        claimKey: args.claimKey ?? null,
      });
      if (res.ok === true) {
        return { ok: true, channel: "whatsapp", reason: null, error: null, url, expiresAt };
      }
      waError = {
        ok: false,
        channel: null,
        reason: (res as { reason: OwnerReportSendResult["reason"] }).reason,
        error: (res as { error: string }).error,
        url,
        expiresAt,
      };
      // "Ya se había mandado" NO es un fallo del que haya que reponerse por
      // correo: es el barrido corriendo dos veces.
      if (waError.reason === "duplicate") return waError;
    } catch (e) {
      // Un fallo de WhatsApp no puede tumbar la pantalla ni el barrido.
      console.warn("[realty/reports] WhatsApp del reporte falló:", (e as Error).message);
      waError = {
        ok: false,
        channel: null,
        reason: "meta",
        error: "No se pudo mandar por WhatsApp.",
        url,
        expiresAt,
      };
    }
  } else if (!phone) {
    waError = {
      ok: false,
      channel: null,
      reason: "phone",
      error: "Este propietario no tiene teléfono capturado.",
      url,
      expiresAt,
    };
  } else {
    waError = {
      ok: false,
      channel: null,
      reason: "plan",
      error: "Tu plan no incluye WhatsApp. Copia la liga y mándasela por donde prefieras.",
      url,
      expiresAt,
    };
  }

  // ── Correo ──
  // Solo el barrido automático lo pide. Desde la pantalla, el asesor tiene
  // el botón de copiar la liga enfrente y decide él por dónde mandarla.
  if (args.allowEmail && owner?.email) {
    try {
      const { sendEmail } = await import("@/lib/email");
      const res = await sendEmail({
        to: owner.email,
        subject: `Cómo va ${report.propertyTitle} — ${report.from} al ${report.to}`,
        html: ownerReportEmailHtml({
          body,
          url,
          accountName: ctx.account.name,
          headline: report.recommendation.headline,
        }),
        text: body,
      });
      if (res.delivered) {
        return { ok: true, channel: "email", reason: null, error: null, url, expiresAt };
      }
      return {
        ok: false,
        channel: null,
        reason: "email",
        error: "El correo no salió. Copia la liga y mándasela tú.",
        url,
        expiresAt,
      };
    } catch (e) {
      console.warn("[realty/reports] correo del reporte falló:", (e as Error).message);
      return {
        ok: false,
        channel: null,
        reason: "email",
        error: "El correo no salió. Copia la liga y mándasela tú.",
        url,
        expiresAt,
      };
    }
  }

  return (
    waError ?? {
      ok: false,
      channel: null,
      reason: "phone",
      error: "Este propietario no tiene ni teléfono ni correo capturados.",
      url,
      expiresAt,
    }
  );
}

/** HTML mínimo y sin imágenes: el correo tiene que verse bien en Outlook. */
function ownerReportEmailHtml(args: {
  body: string;
  url: string;
  accountName: string;
  headline: string;
}): string {
  const parrafos = args.body
    .split("\n")
    .map((l) => escapeHtmlLite(l))
    .join("<br/>");
  return [
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#14201A;line-height:1.6">',
    `<p>${parrafos}</p>`,
    `<p><a href="${escapeHtmlLite(args.url)}" style="display:inline-block;background:#2F6B4D;color:#fff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:bold">Ver el reporte</a></p>`,
    `<p style="color:#6B776F;font-size:12px">La liga funciona ${REPORT_LINK_DAYS} días y luego caduca.</p>`,
    "</div>",
  ].join("");
}

function escapeHtmlLite(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── El envío automático semanal ────────────────────────────────────────

/**
 * QUÉ INMUEBLES ENTRAN, Y POR QUÉ NO HAY UNA CASILLA "mandar cada semana".
 *
 * 🔴 Este vertical NO tiene dónde guardar esa casilla: `RealtyProperty` y
 * `RealtyPropertyOwner` no tienen columna libre ni campo Json de ajustes, y
 * el schema es de otra terminal. Inventar una tabla que viva solo en un
 * .sql —sin modelo de Prisma— es la deuda que barber ya tuvo que pagar dos
 * veces (P2022 en una base sin las columnas). No se repite aquí.
 *
 * Así que el interruptor es el que YA EXISTE y que además es el correcto:
 * la EXCLUSIVA VIGENTE. Es literalmente el papel que obliga a informarle al
 * propietario, es por inmueble Y por propietario, el asesor ya la da de
 * alta y la quita desde la ficha, y es lo que este reporte sirve para
 * renovar. Un inmueble sin exclusiva no genera correo automático a nadie.
 *
 * Lo que SÍ falta y va en el reporte de la ola: una columna booleana para
 * poder apagarlo por inmueble sin cancelar la exclusiva. Es UNA columna.
 */
export interface OwnerReportRunSummary {
  accounts: number;
  candidates: number;
  sentWhatsapp: number;
  sentEmail: number;
  skipped: number;
  failed: number;
  /** Cuántos cayeron por cada motivo. Para leer el log de un vistazo. */
  reasons: Record<string, number>;
  /** Días que abarca cada reporte del barrido. */
  windowDays: number;
  /**
   * Inmuebles con exclusiva VIGENTE que no entraron en esta corrida por los
   * topes de abajo, y cuentas que ni se alcanzaron a recorrer.
   *
   * 🔴 Van en el resumen a propósito. Un barrido que recorta en silencio se
   * lee igual que uno que cubrió todo, y el día que una inmobiliaria con
   * 200 exclusivas note que a 140 propietarios nunca les llegó nada, la
   * única forma de saberlo era este número. Distinto de cero = hay que
   * subir los topes o partir el barrido en varias corridas.
   */
  truncated: number;
  accountsSkipped: number;
}

/** Cuánto mira hacia atrás el reporte automático. Ver la nota de abajo. */
export const WEEKLY_REPORT_DAYS = 30;

/** Topes del barrido, para que un cron no se convierta en una factura. */
const WEEKLY_MAX_PER_ACCOUNT = 60;
const WEEKLY_MAX_TOTAL = 500;

/**
 * ── LO QUE LA PANTALLA TIENE QUE PODER DECIR ───────────────────────────
 * Si el envío automático existe pero no se ve, nadie lo usa y —peor— nadie
 * entiende por qué a un propietario le llega solo y a otro no. Esto es lo
 * que el panel pinta debajo del botón de WhatsApp, en una frase.
 *
 * `channel` es por dónde le llegaría HOY, con el mismo orden que sigue
 * `sendOwnerReport`: WhatsApp si hay teléfono Y el plan lo incluye, correo
 * si no, y nada si el propietario no tiene ni uno ni otro. No promete la
 * entrega —la ventana de 24 h de Meta se decide en el momento— pero sí
 * dice la verdad sobre lo que está configurado.
 */
export interface OwnerReportSchedule {
  /** ¿Este inmueble entra en el barrido de los lunes? */
  auto: boolean;
  /** Hasta cuándo. Es la fecha de fin de la exclusiva, en ISO. */
  until: string | null;
  channel: OwnerReportChannel | null;
  ownerHasPhone: boolean;
  ownerHasEmail: boolean;
  /** Días que abarca cada reporte automático. */
  windowDays: number;
  /**
   * Días que aguanta la liga firmada. Viaja en el DTO y NO se importa en la
   * pantalla: `REPORT_LINK_DAYS` vive en este archivo, que es `server-only`,
   * y basta con que un componente `"use client"` importe UNA constante de
   * aquí para que el bundle se lo trague y el build se caiga.
   */
  linkDays: number;
}

/**
 * ¿A este inmueble le sale el reporte solo?
 *
 * El interruptor es la EXCLUSIVA VIGENTE, no una casilla: ver la nota larga
 * de `runWeeklyOwnerReports`. Esta función solo LEE lo mismo que lee el
 * barrido, para que la pantalla y el cron no puedan discrepar.
 *
 * El inmueble se comprueba contra el alcance del usuario ANTES de tocar la
 * exclusiva: si no es suyo, la respuesta es "no" y no un error que revele
 * que existe.
 */
export async function getOwnerReportSchedule(
  ctx: RealtyContext,
  propertyId: string,
  now: Date = new Date(),
): Promise<OwnerReportSchedule> {
  const apagado: OwnerReportSchedule = {
    auto: false,
    until: null,
    channel: null,
    ownerHasPhone: false,
    ownerHasEmail: false,
    windowDays: WEEKLY_REPORT_DAYS,
    linkDays: REPORT_LINK_DAYS,
  };
  if (!safeId(propertyId)) return apagado;

  const scope = await propertyScopeWhere(ctx);
  const property = await prisma.realtyProperty.findFirst({
    where: { ...scope, id: propertyId },
    select: { id: true, owner: { select: { phone: true, email: true } } },
  });
  if (!property) return apagado;

  const owner = property.owner;
  const ownerHasPhone = Boolean(owner?.phone && mxTenDigits(owner.phone));
  const ownerHasEmail = Boolean(owner?.email && owner.email.trim() !== "");

  const exclusive = await prisma.realtyExclusive.findFirst({
    where: {
      accountId: ctx.accountId,
      propertyId: property.id,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    // La que más tarde vence: si alguien registró dos traslapadas, la que
    // manda es la que mantiene vivo el compromiso.
    orderBy: { endsAt: "desc" },
    select: { endsAt: true },
  });

  const channel: OwnerReportChannel | null =
    ownerHasPhone && ctx.plan.features.whatsapp === true
      ? "whatsapp"
      : ownerHasEmail
        ? "email"
        : null;

  return {
    // Sin canal no hay envío automático por más exclusiva que haya: el
    // barrido lo saltaría con "sin_contacto", así que la pantalla no puede
    // prometer un correo que nunca va a salir.
    auto: Boolean(exclusive) && channel !== null,
    until: exclusive ? exclusive.endsAt.toISOString() : null,
    channel,
    ownerHasPhone,
    ownerHasEmail,
    windowDays: WEEKLY_REPORT_DAYS,
    linkDays: REPORT_LINK_DAYS,
  };
}

/** "2026-W35" — la llave que impide mandar dos veces el mismo lunes. */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO-8601: el jueves de esa semana decide a qué año pertenece.
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${week < 10 ? "0" : ""}${week}`;
}

/**
 * El barrido semanal. Recorre las cuentas activas, junta los inmuebles con
 * exclusiva VIGENTE y le manda a cada propietario su reporte.
 *
 * La liga se firma a nombre del ASESOR ASIGNADO al inmueble (y si no hay,
 * del dueño de la cuenta): así el alcance del reporte es el de una persona
 * real y la liga muere con ella. Un contexto de "sistema" con permisos de
 * más sería justo el agujero que este archivo evita en todas las demás
 * consultas.
 */
export async function runWeeklyOwnerReports(now: Date = new Date()): Promise<OwnerReportRunSummary> {
  const summary: OwnerReportRunSummary = {
    accounts: 0,
    candidates: 0,
    sentWhatsapp: 0,
    sentEmail: 0,
    skipped: 0,
    failed: 0,
    reasons: {},
    windowDays: WEEKLY_REPORT_DAYS,
    truncated: 0,
    accountsSkipped: 0,
  };
  const bump = (key: string) => {
    summary.reasons[key] = (summary.reasons[key] ?? 0) + 1;
  };

  // 🔴 Sin URL pública NO se manda nada. Un cron no tiene petición de la que
  // sacar el origin, y un mensaje con una liga a "undefined/api/..." es peor
  // que no mandar el mensaje: quema la confianza del propietario.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    "";
  if (!baseUrl) {
    console.error("[realty/reports] barrido semanal sin URL pública: no se mandó nada");
    bump("sin_url");
    return summary;
  }

  const week = isoWeekKey(now);

  const accounts = await prisma.realtyAccount.findMany({
    where: {
      isActive: true,
      subscriptionStatus: { in: Array.from(REALTY_ACTIVE_SUBSCRIPTION_STATUSES) },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  summary.accounts = accounts.length;

  let total = 0;

  for (const acc of accounts) {
    if (total >= WEEKLY_MAX_TOTAL) {
      // Se acabó el presupuesto global y quedan cuentas sin recorrer. No se
      // consulta cuántas exclusivas traían (sería pagar consultas por algo
      // que ya no se va a mandar), pero SÍ queda dicho que existieron.
      summary.accountsSkipped += 1;
      continue;
    }

    const exclusives = await prisma.realtyExclusive.findMany({
      where: {
        accountId: acc.id,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      select: {
        propertyId: true,
        property: {
          select: {
            id: true,
            title: true,
            assignedUserId: true,
            owner: { select: { id: true, phone: true, email: true } },
          },
        },
      },
      orderBy: { endsAt: "asc" },
      take: WEEKLY_MAX_PER_ACCOUNT,
    });
    if (exclusives.length === 0) continue;
    // El `take` de arriba prioriza las exclusivas que ANTES vencen —que es
    // el orden correcto, porque este reporte sirve justo para renovarlas—
    // pero recorta. Si tocó el tope, se pregunta cuántas quedaron fuera.
    if (exclusives.length === WEEKLY_MAX_PER_ACCOUNT) {
      const vigentes = await prisma.realtyExclusive.count({
        where: { accountId: acc.id, startsAt: { lte: now }, endsAt: { gt: now } },
      });
      summary.truncated += Math.max(0, vigentes - WEEKLY_MAX_PER_ACCOUNT);
    }

    // Un contexto por asesor, no uno por inmueble: la mayoría de una cuenta
    // cuelga del mismo puñado de personas.
    const ctxCache = new Map<string, RealtyContext | null>();
    let fallbackOwnerCtx: RealtyContext | null | undefined;

    for (const ex of exclusives) {
      if (total >= WEEKLY_MAX_TOTAL) {
        // El tope global cortó a media cuenta: lo que queda de esta lista
        // tampoco se manda, y se dice.
        summary.truncated += 1;
        continue;
      }
      const property = ex.property;
      if (!property) continue;

      summary.candidates += 1;

      const owner = property.owner;
      if (!owner || (!owner.phone && !owner.email)) {
        summary.skipped += 1;
        bump("sin_contacto");
        continue;
      }

      let ctx: RealtyContext | null = null;
      if (property.assignedUserId) {
        if (!ctxCache.has(property.assignedUserId)) {
          ctxCache.set(
            property.assignedUserId,
            await realtyContextForUser(property.assignedUserId),
          );
        }
        ctx = ctxCache.get(property.assignedUserId) ?? null;
      }
      if (!ctx) {
        if (fallbackOwnerCtx === undefined) {
          const dueno = await prisma.realtyUser.findFirst({
            where: { accountId: acc.id, active: true, role: "OWNER" },
            select: { id: true },
            orderBy: { createdAt: "asc" },
          });
          fallbackOwnerCtx = dueno ? await realtyContextForUser(dueno.id) : null;
        }
        ctx = fallbackOwnerCtx;
      }
      if (!ctx) {
        summary.skipped += 1;
        bump("sin_usuario");
        continue;
      }

      const tz = accountTimezone(ctx);
      const to = ymd(now, tz);
      const from = ymd(new Date(now.getTime() - WEEKLY_REPORT_DAYS * 86_400_000), tz);

      total += 1;
      try {
        const res = await sendOwnerReport(
          ctx,
          {
            propertyId: property.id,
            from,
            to,
            baseUrl,
            // Idempotente por inmueble y semana ISO: si el cron corre dos
            // veces el mismo lunes, el segundo choca y no manda nada.
            claimKey: `ownerReport:${property.id}:${week}`,
            allowEmail: true,
          },
          now,
        );
        if (res.ok && res.channel === "whatsapp") summary.sentWhatsapp += 1;
        else if (res.ok && res.channel === "email") summary.sentEmail += 1;
        else {
          if (res.reason === "duplicate") summary.skipped += 1;
          else summary.failed += 1;
          bump(res.reason ?? "desconocido");
        }
      } catch (e) {
        summary.failed += 1;
        bump("excepcion");
        console.warn(
          `[realty/reports] barrido: ${property.title} falló:`,
          (e as Error).message,
        );
      }
    }
  }

  return summary;
}
