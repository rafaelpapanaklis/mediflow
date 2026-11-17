// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — ESTRELLAS y BONOS (núcleo sin sesión).
//
// Decisión de Rafael (15-nov-2026): la tarjeta de lealtad se ve como
// ESTRELLAS dentro de la cuenta del cliente, la barbería crea VARIOS bonos
// (cada uno cuesta N estrellas) y los aplica ella.
//
// Las estrellas NO se guardan: se cuentan, igual que los sellos de antes
// (loyalty-core.ts → liveStars). Este módulo añade lo que faltaba:
//
//   · el catálogo de bonos de la barbería (tabla barber_loyalty_rewards,
//     sql/barber_estrellas.sql). Mientras ese SQL no esté pegado —o si la
//     barbería todavía no ha creado ninguno— el premio único de siempre
//     (umbral + nombre de barber_shops) ES el primer bono, con su id fijo
//     LEGACY_BONUS_ID. Nada de lo acumulado se pierde: las estrellas son las
//     mismas y los canjes viejos siguen restando lo que costaron;
//   · el HISTORIAL de estrellas (cada visita, cada canje, cada ajuste a mano,
//     y por qué una visita no dio estrella);
//   · la TARJETA POR ENLACE: un token firmado con HMAC, por cliente y por
//     barbería, revocable (cambia la versión guardada en __card).
//
// Sin "server-only" y sin importar prisma: recibe el cliente de base (o el
// `tx` de una transacción). Así lo usan cash.ts —que las pruebas cargan en
// Node pelado—, el portal y la página pública de la tarjeta.
// ═══════════════════════════════════════════════════════════════════════
import { createHmac, timingSafeEqual } from "crypto";
import { portalSecret } from "@/lib/barber/portal-core";
import { BARBER_SALE_TAG_PREFIX } from "@/lib/barber/memberships-core";
import {
  APPOINTMENT_GIVES_STAR,
  LOYALTY_DEFAULT_REWARD,
  LOYALTY_THRESHOLD_MAX,
  LOYALTY_THRESHOLD_MIN,
  NOT_CANCELLED,
  cancelledBeforeStarRule,
  clampLoyaltyThreshold,
  getLoyaltyRule,
  parseLoyaltyLine,
  readStarsLedger,
  refreshLoyalty,
  type LoyaltyDb,
  type LoyaltyRule,
} from "@/lib/barber/loyalty-core";

/** Marca de ticket cancelado (misma de commissions.ts / loyalty-core.ts). */
const CANCELLED_MARK = "[CANCELADA]";

// ── Los bonos ───────────────────────────────────────────────────────────

/**
 * Qué da el bono:
 *   · service → un servicio gratis (serviceId null = «el servicio que elijas
 *               en caja», que es como funcionaba el premio de siempre);
 *   · amount  → descuento en pesos sobre el ticket;
 *   · percent → descuento en % sobre el ticket;
 *   · other   → algo que no pasa por el ticket (texto libre: «una gorra»).
 */
export type BonusKind = "service" | "amount" | "percent" | "other";
export const BONUS_KINDS: readonly BonusKind[] = ["service", "amount", "percent", "other"];

export interface StarBonus {
  id: string;
  name: string;
  /** Cuántas estrellas cuesta (1–100, el mismo rango del umbral de siempre). */
  cost: number;
  kind: BonusKind;
  serviceId: string | null;
  /** Nombre del servicio del catálogo (resuelto al leer). */
  serviceName: string | null;
  amount: number | null;
  percent: number | null;
  /** Texto libre del bono «otro». */
  description: string | null;
  active: boolean;
  sortOrder: number;
}

/** Id del bono que nace del premio único de siempre (antes del SQL o sin bonos). */
export const LEGACY_BONUS_ID = "premio";

/** Id de la fila en que sql/barber_estrellas.sql convirtió el premio de siempre. */
export function seededBonusId(barbershopId: string): string {
  return `premio-${barbershopId}`;
}
export const BONUS_NAME_MAX = 60;
export const BONUS_TEXT_MAX = 140;
export const BONUS_MAX_PER_SHOP = 12;
export const BONUS_AMOUNT_MAX = 10_000;
export const BONUS_COST_MIN = LOYALTY_THRESHOLD_MIN;
export const BONUS_COST_MAX = LOYALTY_THRESHOLD_MAX;

/** El premio de siempre, visto como bono. */
export function legacyBonus(rule: LoyaltyRule): StarBonus {
  return {
    id: LEGACY_BONUS_ID,
    name: rule.reward || LOYALTY_DEFAULT_REWARD,
    cost: clampLoyaltyThreshold(rule.threshold),
    kind: "service",
    serviceId: null,
    serviceName: null,
    amount: null,
    percent: null,
    description: null,
    active: true,
    sortOrder: 0,
  };
}

/**
 * ¿Existe ya la tabla de bonos? `to_regclass` nunca falla: dentro de una
 * transacción (el cobro) un SELECT a una tabla inexistente la ABORTARÍA
 * entera, así que primero se pregunta y luego se lee.
 */
export async function bonusTableReady(db: LoyaltyDb): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<Array<{ ok: boolean }>>`
      SELECT to_regclass('public.barber_loyalty_rewards') IS NOT NULL AS "ok"
    `;
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

interface BonusRow {
  id: string;
  name: string;
  cost: number;
  kind: string;
  serviceId: string | null;
  amount: number | string | null;
  percent: number | null;
  description: string | null;
  active: boolean;
  sortOrder: number;
}

function toBonus(row: BonusRow, serviceNames: Map<string, string>): StarBonus {
  const kind = (BONUS_KINDS as readonly string[]).includes(row.kind) ? (row.kind as BonusKind) : "other";
  const amount = row.amount === null || row.amount === undefined ? null : Number(row.amount);
  return {
    id: row.id,
    name: row.name,
    cost: clampLoyaltyThreshold(Number(row.cost)),
    kind,
    serviceId: row.serviceId,
    serviceName: row.serviceId ? serviceNames.get(row.serviceId) ?? null : null,
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    percent: row.percent === null || row.percent === undefined ? null : Number(row.percent),
    description: row.description,
    active: row.active !== false,
    sortOrder: Number(row.sortOrder) || 0,
  };
}

export interface BonusCatalog {
  /** Activos e inactivos, en orden (sortOrder, costo). */
  bonuses: StarBonus[];
  /** La tabla de bonos ya existe (sql/barber_estrellas.sql pegado). */
  tableReady: boolean;
  /** Todavía es el premio único de siempre (no hay filas propias). */
  legacy: boolean;
  rule: LoyaltyRule;
}

/**
 * El catálogo de bonos de ESA barbería. El barbershopId lo pone quien llama
 * (sesión del panel o slug de la página pública), nunca el navegador.
 */
export async function loadBonusCatalog(db: LoyaltyDb, barbershopId: string): Promise<BonusCatalog> {
  const rule = await getLoyaltyRule(db, barbershopId);
  if (!barbershopId) return { bonuses: [legacyBonus(rule)], tableReady: false, legacy: true, rule };
  const tableReady = await bonusTableReady(db);
  if (!tableReady) return { bonuses: [legacyBonus(rule)], tableReady, legacy: true, rule };

  const rows = await db.$queryRaw<BonusRow[]>`
    SELECT "id", "name", "cost", "kind", "serviceId", "amount"::float8 AS "amount",
           "percent", "description", "active", "sortOrder"
    FROM "barber_loyalty_rewards"
    WHERE "barbershopId" = ${barbershopId}
    ORDER BY "sortOrder" ASC, "cost" ASC, "createdAt" ASC
  `;
  if (rows.length === 0) return { bonuses: [legacyBonus(rule)], tableReady, legacy: true, rule };

  const serviceIds = Array.from(new Set(rows.map((r) => r.serviceId).filter((x): x is string => !!x)));
  const services = serviceIds.length
    ? await db.barberService.findMany({
        where: { barbershopId, id: { in: serviceIds } },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(services.map((s) => [s.id, s.name]));
  return { bonuses: rows.map((r) => toBonus(r, names)), tableReady, legacy: false, rule };
}

/** Solo los activos, del más barato al más caro. */
export function activeBonuses(bonuses: StarBonus[]): StarBonus[] {
  return bonuses.filter((b) => b.active).slice().sort((a, b) => a.cost - b.cost || a.sortOrder - b.sortOrder);
}

/** Bonos que ya puede canjear con esas estrellas. */
export function availableBonuses(stars: number, bonuses: StarBonus[]): StarBonus[] {
  return activeBonuses(bonuses).filter((b) => b.cost <= stars);
}

/** El siguiente bono que todavía no alcanza (el más barato por encima). */
export function nextBonus(stars: number, bonuses: StarBonus[]): { bonus: StarBonus; remaining: number } | null {
  const next = activeBonuses(bonuses).find((b) => b.cost > stars);
  return next ? { bonus: next, remaining: next.cost - stars } : null;
}

/** El bono más barato (el que se usa como «umbral» de compatibilidad). */
export function cheapestBonus(bonuses: StarBonus[]): StarBonus | null {
  return activeBonuses(bonuses)[0] ?? null;
}

/**
 * Cuántas estrellas se dibujan en la tarjeta: hasta el siguiente bono; si ya
 * los alcanzó todos, hasta el más caro (o sus estrellas, si tiene más).
 */
export function cardSlots(stars: number, bonuses: StarBonus[]): number {
  const act = activeBonuses(bonuses);
  if (act.length === 0) return Math.max(stars, 1);
  const next = nextBonus(stars, act);
  if (next) return next.bonus.cost;
  return Math.max(act[act.length - 1].cost, stars);
}

// ── Lo que el cliente ve de un bono ─────────────────────────────────────

/** Lo que da un bono, ya resuelto (el texto lo arma cada pantalla con su i18n). */
export interface BonusWhat {
  kind: BonusKind;
  serviceName: string | null;
  amount: number | null;
  percent: number | null;
  text: string | null;
}

export interface BonusPublic {
  id: string;
  name: string;
  cost: number;
  what: BonusWhat;
}

export function toBonusPublic(b: StarBonus): BonusPublic {
  return {
    id: b.id,
    name: b.name,
    cost: b.cost,
    what: {
      kind: b.kind,
      serviceName: b.kind === "service" ? b.serviceName : null,
      amount: b.kind === "amount" ? b.amount : null,
      percent: b.kind === "percent" ? b.percent : null,
      text: b.kind === "other" ? b.description : null,
    },
  };
}

// ── Validación del catálogo (lo que manda Clientes → Estrellas y bonos) ──

export interface BonusInput {
  id: string | null;
  name: string;
  cost: number;
  kind: BonusKind;
  serviceId: string | null;
  amount: number | null;
  percent: number | null;
  description: string | null;
  active: boolean;
}

export class BonusValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BonusValidationError";
  }
}

/**
 * Valida y normaliza UN bono que viene del navegador. Lanza con un mensaje
 * para la pantalla. `serviceIds` = servicios de ESTA barbería: un servicio
 * de otra no se puede poner como premio.
 */
export function normalizeBonusInput(raw: unknown, index: number, serviceIds: Set<string>): BonusInput {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const label = `Bono ${index + 1}`;
  const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, BONUS_NAME_MAX) : "";
  if (!name) throw new BonusValidationError(`${label}: ponle nombre (ej. Corte gratis).`);
  const costN = Number(r.cost);
  if (!Number.isInteger(costN) || costN < BONUS_COST_MIN || costN > BONUS_COST_MAX) {
    throw new BonusValidationError(`${label}: las estrellas van de ${BONUS_COST_MIN} a ${BONUS_COST_MAX}.`);
  }
  const kind = (BONUS_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as BonusKind) : null;
  if (!kind) throw new BonusValidationError(`${label}: elige qué da el bono.`);
  const id = typeof r.id === "string" && r.id && r.id.length <= 64 ? r.id : null;
  const out: BonusInput = {
    id,
    name,
    cost: costN,
    kind,
    serviceId: null,
    amount: null,
    percent: null,
    description: null,
    active: r.active !== false,
  };
  if (kind === "service") {
    const sid = typeof r.serviceId === "string" && r.serviceId ? r.serviceId : null;
    if (sid && !serviceIds.has(sid)) throw new BonusValidationError(`${label}: ese servicio no es de tu barbería.`);
    out.serviceId = sid;
  } else if (kind === "amount") {
    const a = Math.round(Number(r.amount) * 100) / 100;
    if (!Number.isFinite(a) || a <= 0 || a > BONUS_AMOUNT_MAX) {
      throw new BonusValidationError(`${label}: el descuento va de $1 a $${BONUS_AMOUNT_MAX.toLocaleString("es-MX")}.`);
    }
    out.amount = a;
  } else if (kind === "percent") {
    const p = Number(r.percent);
    if (!Number.isInteger(p) || p < 1 || p > 100) throw new BonusValidationError(`${label}: el porcentaje va de 1 a 100.`);
    out.percent = p;
  } else {
    const text = typeof r.description === "string" ? r.description.replace(/\s+/g, " ").trim().slice(0, BONUS_TEXT_MAX) : "";
    if (!text) throw new BonusValidationError(`${label}: escribe qué se lleva el cliente.`);
    out.description = text;
  }
  return out;
}

// ── Bitácora de canjes de la FICHA (__loyalty) ──────────────────────────
// La escribe loyalty.ts (server-only); aquí solo se LEE para el historial.

export interface DeskRedemption {
  at: string;
  stars: number;
  reward: string;
  rewardId: string | null;
  /** Visita sobre la que se entregó (el canje viejo la guardaba; «Marcar como entregado», no). */
  appointmentId: string | null;
  byUserId: string;
  note: string | null;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function readDeskRedemptions(preferences: unknown): DeskRedemption[] {
  const node = obj(obj(preferences).__loyalty);
  const list = Array.isArray(node.redemptions) ? node.redemptions : [];
  return list
    .map((e) => {
      const r = obj(e);
      const n = Number(r.threshold);
      return {
        at: typeof r.at === "string" ? r.at : "",
        stars: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
        reward: typeof r.reward === "string" && r.reward ? r.reward : LOYALTY_DEFAULT_REWARD,
        rewardId: typeof r.rewardId === "string" ? r.rewardId : null,
        appointmentId: typeof r.appointmentId === "string" ? r.appointmentId : null,
        byUserId: typeof r.byUserId === "string" ? r.byUserId : "",
        note: typeof r.note === "string" && r.note ? r.note : null,
      };
    })
    .filter((r) => r.at);
}

// ── El historial de estrellas ───────────────────────────────────────────

/**
 * Una fila del historial.
 *   · visit    → +1: cita completada («appointment») o servicio cobrado sin
 *                cita («walkin»).
 *   · no_star  →  0: visita que NO dio estrella y por qué («cancelled»,
 *                «no_show», «ticket_cancelled»).
 *   · redeem   → −N: bono canjeado en caja («cash») o entregado desde la
 *                ficha («desk»).
 *   · returned →  0: canje cuyo ticket se canceló; las estrellas volvieron.
 *   · manual   → ±1: estrella dada o quitada a mano por la barbería.
 */
export type StarEventKind = "visit" | "no_star" | "redeem" | "returned" | "manual";
export type StarEventReason =
  | "appointment"
  | "walkin"
  | "cancelled"
  | "no_show"
  | "ticket_cancelled"
  | "cash"
  | "desk"
  | "manual";

export interface StarEvent {
  id: string;
  at: string;
  kind: StarEventKind;
  reason: StarEventReason;
  delta: number;
  /** Servicios de la visita, o el nombre del bono. */
  detail: string;
  /** SOLO para la barbería: motivo del ajuste o nota del canje. */
  note?: string | null;
  /** SOLO para la barbería: quién lo hizo. */
  by?: string | null;
}

export const STARS_HISTORY_MAX = 80;

export interface StarsView {
  /** La barbería tiene encendida la tarjeta. */
  enabled: boolean;
  /** Nombre de pila (lo único personal que viaja a la tarjeta por enlace). */
  firstName: string;
  stars: number;
  /** Estrellas que se dibujan en la tarjeta. */
  slots: number;
  next: { bonus: BonusPublic; remaining: number } | null;
  /** Bonos que ya puede pedir. */
  available: BonusPublic[];
  /** Todos los bonos activos (lo que se puede ganar). */
  catalog: BonusPublic[];
  history: StarEvent[];
  /** Bonos ya usados (los canjes del historial, en orden). */
  usedCount: number;
}

type Audience = "client" | "staff";

function serviceNamesOf(items: Array<{ description: string; serviceId?: string | null }>): string {
  return items
    .filter((i) => i.serviceId)
    .map((i) => parseLoyaltyLine(i.description)?.head ?? i.description)
    .join(" + ");
}

/**
 * Todo lo que pinta la tarjeta de estrellas de UN cliente: el número fresco
 * (recontado ahora, no la caché), el siguiente bono, los disponibles y el
 * historial. `audience: "client"` quita motivos y nombres del personal.
 *
 * Devuelve null si el cliente no es de esa barbería.
 */
export async function loadStarsView(
  db: LoyaltyDb,
  args: {
    barbershopId: string;
    clientId: string;
    audience: Audience;
    /**
     * Rol Barbero en un cliente SUYO (regla de la rama de sedes, aa58760dc:
     * «que vea solo lo de él»): el historial lleva solo las visitas y los
     * tickets que atendió él, y los bonos entregados sobre una visita suya.
     * Los ajustes a mano y lo hecho con otro barbero no salen. El NÚMERO de
     * estrellas no cambia: es el de la tarjeta.
     */
    onlyBarberId?: string | null;
    now?: Date;
  },
): Promise<StarsView | null> {
  const { barbershopId, clientId, audience } = args;
  const mine = args.onlyBarberId ? { barberId: args.onlyBarberId } : {};
  if (!barbershopId || !clientId) return null;
  const now = args.now ?? new Date();

  const client = await db.barberClient.findFirst({
    where: { id: clientId, barbershopId },
    select: { id: true, name: true, preferences: true, loyaltyCount: true },
  });
  if (!client) return null;

  const [catalog, fresh] = await Promise.all([
    loadBonusCatalog(db, barbershopId),
    refreshLoyalty(db, barbershopId, [clientId]),
  ]);
  const stars = fresh.get(clientId)?.count ?? client.loyaltyCount;

  const [appointments, sales, services] = await Promise.all([
    db.barberAppointment.findMany({
      where: {
        barbershopId,
        clientId,
        status: { in: ["DONE", "CANCELLED", "NO_SHOW"] },
        startAt: { lte: now },
        ...mine,
      },
      orderBy: { startAt: "desc" },
      take: STARS_HISTORY_MAX,
      select: {
        id: true,
        startAt: true,
        status: true,
        services: { select: { service: { select: { name: true } } } },
        sales: { select: { notes: true } },
      },
    }),
    db.barberSale.findMany({
      where: { barbershopId, clientId, ...mine },
      orderBy: { createdAt: "desc" },
      take: STARS_HISTORY_MAX,
      select: {
        id: true,
        createdAt: true,
        notes: true,
        appointmentId: true,
        items: { select: { description: true, serviceId: true } },
      },
    }),
    // Nombres de los servicios: para reconocer, en un ticket ya cancelado (sin
    // líneas), si aquella visita de mostrador llevaba servicio.
    db.barberService.findMany({ where: { barbershopId }, select: { name: true } }),
  ]);
  const serviceNames = services.map((x) => x.name).filter((n) => n.length > 0);

  const events: StarEvent[] = [];
  const isCancelled = (notes: string | null) => typeof notes === "string" && notes.startsWith(CANCELLED_MARK);

  for (const a of appointments) {
    const services = a.services.map((s) => s.service?.name ?? "").filter(Boolean).join(" + ");
    const at = a.startAt.toISOString();
    if (a.status === "DONE") {
      const live = a.sales.filter((s) => !isCancelled(s.notes));
      // Misma regla que el recuento (APPOINTMENT_GIVES_STAR), con su fecha de inicio.
      const gives = a.sales.length === 0 || live.length > 0 || a.sales.some((x) => cancelledBeforeStarRule(x.notes));
      events.push({
        id: `a-${a.id}`,
        at,
        kind: gives ? "visit" : "no_star",
        reason: gives ? "appointment" : "ticket_cancelled",
        delta: gives ? 1 : 0,
        detail: services,
      });
    } else {
      events.push({
        id: `a-${a.id}`,
        at,
        kind: "no_star",
        reason: a.status === "NO_SHOW" ? "no_show" : "cancelled",
        delta: 0,
        detail: services,
      });
    }
  }

  for (const s of sales) {
    const cancelled = isCancelled(s.notes);
    const at = s.createdAt.toISOString();
    if (cancelled) {
      // Cancelar BORRA las líneas del ticket (cash.ts → cancelSaleTx); lo que
      // llevaba queda escrito en la marca: «… · Original: <líneas> · subtotal …».
      // Los tickets de mostrador (membresía, anticipo) nunca dieron estrella.
      if (typeof s.notes === "string" && s.notes.includes(BARBER_SALE_TAG_PREFIX)) continue;
      const original = originalSummaryOf(s.notes);
      if (!s.appointmentId && serviceNames.some((n) => original.includes(n))) {
        events.push({
          id: `s-${s.id}`,
          at,
          kind: "no_star",
          reason: "ticket_cancelled",
          delta: 0,
          detail: original.replace(LOYALTY_MARK_GLOBAL, ""),
        });
      }
      const returned = original.match(LOYALTY_MARK_GLOBAL) ?? [];
      returned.forEach((_, i) => {
        events.push({ id: `r-${s.id}-${i}`, at, kind: "returned", reason: "cash", delta: 0, detail: "" });
      });
      continue;
    }
    // Visita de mostrador (sin cita): la que da estrella por sí misma.
    if (!s.appointmentId && s.items.some((i) => i.serviceId)) {
      events.push({
        id: `s-${s.id}`,
        at,
        kind: cancelled ? "no_star" : "visit",
        reason: cancelled ? "ticket_cancelled" : "walkin",
        delta: cancelled ? 0 : 1,
        detail: serviceNamesOf(s.items),
      });
    }
    // Canjes hechos en caja (uno por línea marcada).
    s.items.forEach((item, i) => {
      const line = parseLoyaltyLine(item.description);
      if (!line) return;
      const detail = line.kind === "free" ? line.head : line.bonusName ?? "";
      events.push({
        id: `r-${s.id}-${i}`,
        at,
        kind: cancelled ? "returned" : "redeem",
        reason: "cash",
        delta: cancelled ? 0 : -line.stars,
        detail,
      });
    });
  }

  const myAppointments = new Set(appointments.map((a) => a.id));
  readDeskRedemptions(client.preferences).forEach((r, i) => {
    if (args.onlyBarberId && !(r.appointmentId && myAppointments.has(r.appointmentId))) return;
    events.push({
      id: `d-${i}-${r.at}`,
      at: r.at,
      kind: "redeem",
      reason: "desk",
      delta: -r.stars,
      detail: r.reward,
      ...(audience === "staff" ? { note: r.note } : {}),
    });
  });

  for (const m of args.onlyBarberId ? [] : readStarsLedger(client.preferences).entries) {
    events.push({
      id: `m-${m.id || m.at}`,
      at: m.at,
      kind: "manual",
      reason: "manual",
      delta: m.delta,
      detail: "",
      ...(audience === "staff" ? { note: m.reason || null, by: m.byName || null } : {}),
    });
  }

  events.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));

  const active = activeBonuses(catalog.bonuses);
  const next = nextBonus(stars, active);
  return {
    enabled: catalog.rule.enabled,
    firstName: firstNameOf(client.name),
    stars,
    slots: cardSlots(stars, active),
    next: next ? { bonus: toBonusPublic(next.bonus), remaining: next.remaining } : null,
    available: availableBonuses(stars, active).map(toBonusPublic),
    catalog: active.map(toBonusPublic),
    history: events.slice(0, STARS_HISTORY_MAX),
    usedCount: events.filter((e) => e.kind === "redeem").length,
  };
}

/** Las marcas de canje dentro de un texto (para el resumen de un ticket cancelado). */
const LOYALTY_MARK_GLOBAL = / · (?:Gratis|Descuento|Regalo) \(lealtad(?: · \d{1,3} (?:sellos?|estrellas?))?\)/g;

/** Lo que llevaba un ticket cancelado, según su marca («Original: …»). */
export function originalSummaryOf(notes: string | null | undefined): string {
  if (typeof notes !== "string") return "";
  const firstLine = notes.split("\n")[0];
  const at = firstLine.lastIndexOf("Original: ");
  if (at < 0) return "";
  const rest = firstLine.slice(at + "Original: ".length);
  const cut = rest.lastIndexOf(" · subtotal ");
  return (cut >= 0 ? rest.slice(0, cut) : rest).trim();
}

/** Solo el nombre de pila: es lo único personal que sale por el enlace. */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first.slice(0, 40);
}

// ── Tarjeta por enlace (token firmado y revocable) ──────────────────────
//
//   token = <clientId>.<versión>.<firma>
//   firma = HMAC-SHA256(secreto, "dcb-card-v1|<barbershopId>|<clientId>|<versión>")
//
// · No se adivina: la firma son 192 bits de un HMAC con la llave del servidor.
// · No sirve para otro cliente ni para otra barbería: los dos ids van firmados
//   y la página compara contra la barbería del slug.
// · Se revoca subiendo la versión guardada en preferences.__card: el enlace
//   viejo deja de cuadrar y la barbería entrega uno nuevo.

export const CARD_KEY = "__card";

export function cardVersion(preferences: unknown): number {
  const v = Number(obj(obj(preferences)[CARD_KEY]).v);
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

function cardMac(barbershopId: string, clientId: string, version: number): string {
  return createHmac("sha256", portalSecret())
    .update(`dcb-card-v1|${barbershopId}|${clientId}|${version}`)
    .digest("base64url")
    .slice(0, 32);
}

export function signCardToken(barbershopId: string, clientId: string, version: number): string {
  return `${clientId}.${version}.${cardMac(barbershopId, clientId, version)}`;
}

export function parseCardToken(token: unknown): { clientId: string; version: number; mac: string } | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [clientId, v, mac] = parts;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) return null;
  if (!/^\d{1,6}$/.test(v)) return null;
  if (!/^[A-Za-z0-9_-]{32}$/.test(mac)) return null;
  return { clientId, version: Number(v), mac };
}

/** ¿La firma cuadra para ESA barbería? (la versión vigente se compara aparte). */
export function cardSignatureOk(token: { clientId: string; version: number; mac: string }, barbershopId: string): boolean {
  const expected = Buffer.from(cardMac(barbershopId, token.clientId, token.version));
  const given = Buffer.from(token.mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Ruta de la tarjeta (sin dominio; la pantalla le pone el origin). */
export function cardPath(slug: string, token: string): string {
  return `/b/${encodeURIComponent(slug)}/tarjeta/${token}`;
}

/**
 * Resuelve un token de la página pública al cliente. Null ante cualquier
 * duda: firma que no cuadra, versión revocada, cliente de otra barbería o
 * bloqueado. Nunca dice cuál de todas falló.
 */
export async function resolveCardToken(
  db: LoyaltyDb,
  barbershopId: string,
  rawToken: unknown,
): Promise<{ clientId: string } | null> {
  const token = parseCardToken(rawToken);
  if (!token || !barbershopId) return null;
  if (!cardSignatureOk(token, barbershopId)) return null;
  const client = await db.barberClient.findFirst({
    where: { id: token.clientId, barbershopId },
    select: { id: true, preferences: true, blockedAt: true },
  });
  if (!client || client.blockedAt) return null;
  if (cardVersion(client.preferences) !== token.version) return null;
  return { clientId: client.id };
}

// ── Lo que Caja enseña al terminar de cobrar ────────────────────────────

export interface SaleStarsOutcome {
  firstName: string;
  /** Estrellas que lleva AHORA (con este ticket ya escrito). */
  stars: number;
  /** 1 si este cobro es una visita (cita o servicio en caja); 0 si no. */
  gained: number;
  next: { name: string; cost: number; remaining: number } | null;
  /** Bonos que alcanzó justo con esta estrella. */
  reached: string[];
  /** Bono aplicado en este ticket (si hubo). */
  used: { name: string; stars: number } | null;
  /** Ruta del enlace personal de su tarjeta (para el QR de «cobrado»). */
  cardPath: string;
}

/**
 * «★ +1 estrella para Juan: lleva 7 de 10» y, si con esa alcanza un bono,
 * cuál. Se calcula DESPUÉS del cobro con el número fresco. null si el ticket
 * no tiene cliente o la tarjeta está apagada.
 */
export async function saleStarsOutcome(
  db: LoyaltyDb,
  args: { barbershopId: string; slug: string; saleId: string; bonusId?: string | null },
): Promise<SaleStarsOutcome | null> {
  const { barbershopId } = args;
  if (!barbershopId || !args.saleId) return null;
  const sale = await db.barberSale.findFirst({
    where: { id: args.saleId, barbershopId },
    select: {
      clientId: true,
      appointmentId: true,
      items: { select: { description: true, serviceId: true } },
      client: { select: { name: true, preferences: true } },
    },
  });
  if (!sale?.clientId || !sale.client) return null;
  const catalog = await loadBonusCatalog(db, barbershopId);
  if (!catalog.rule.enabled) return null;
  const stars = (await refreshLoyalty(db, barbershopId, [sale.clientId])).get(sale.clientId)?.count ?? 0;
  const active = activeBonuses(catalog.bonuses);

  const gained = sale.appointmentId || sale.items.some((i) => i.serviceId) ? 1 : 0;
  let used: SaleStarsOutcome["used"] = null;
  for (const item of sale.items) {
    const line = parseLoyaltyLine(item.description);
    if (!line) continue;
    const named = args.bonusId ? active.find((b) => b.id === args.bonusId)?.name : null;
    used = { name: named ?? line.bonusName ?? line.head, stars: line.stars };
    break;
  }
  const reached =
    gained > 0 ? active.filter((b) => b.cost <= stars && b.cost > stars - gained).map((b) => b.name) : [];
  const next = nextBonus(stars, active);
  return {
    firstName: firstNameOf(sale.client.name),
    stars,
    gained,
    next: next ? { name: next.bonus.name, cost: next.bonus.cost, remaining: next.remaining } : null,
    reached,
    used,
    cardPath: cardPath(args.slug, signCardToken(barbershopId, sale.clientId, cardVersion(sale.client.preferences))),
  };
}

/**
 * Ruta de la tarjeta del cliente de UN ticket, para el QR del ticket impreso
 * (ws6-t1, 16-nov): «Escanea y ve tus estrellas». null si el ticket no tiene
 * cliente, si el cliente está bloqueado o si la barbería tiene la tarjeta
 * apagada. Filtra por barbershopId: un ticket ajeno no da nada.
 */
export async function ticketStarsCardPath(
  db: LoyaltyDb,
  args: { barbershopId: string; slug: string; saleId: string },
): Promise<string | null> {
  const { barbershopId, saleId } = args;
  if (!barbershopId || !saleId || !args.slug) return null;
  const sale = await db.barberSale.findFirst({
    where: { id: saleId, barbershopId },
    select: { clientId: true, client: { select: { preferences: true, blockedAt: true } } },
  });
  if (!sale?.clientId || !sale.client || sale.client.blockedAt) return null;
  const catalog = await loadBonusCatalog(db, barbershopId);
  if (!catalog.rule.enabled) return null;
  return cardPath(args.slug, signCardToken(barbershopId, sale.clientId, cardVersion(sale.client.preferences)));
}

// Re-export para quien solo importa este módulo.
export { APPOINTMENT_GIVES_STAR, NOT_CANCELLED };
