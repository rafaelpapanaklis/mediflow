// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — núcleo de la tarjeta de lealtad.
//
// UNA sola definición de «cuántos sellos tiene este cliente» para todo el
// vertical: la ficha (loyalty.ts), la lista de clientes (clients.ts), la
// caja (cash.ts) y «mi cuenta» del cliente (client-portal.ts). Antes cada
// uno leía por su lado la columna barber_clients.loyaltyCount, que es solo
// una CACHÉ: la refrescaba únicamente abrir Clientes, así que la caja decía
// «7 de 10» con el décimo corte ya cobrado, y además usaba 10 sellos fijos
// aunque la barbería hubiera configurado otro número.
//
// El contador NO es un acumulador: se CUENTA desde la fuente de verdad.
//
//     visitas  = citas DONE del cliente
//              + tickets sin cita con al menos un servicio (walk-in)
//     sellos   = visitas − sellos ya canjeados (ficha + caja)
//
// Por eso es idempotente (recontar dos veces da lo mismo), no se puede
// manipular desde el navegador y se corrige solo.
//
// Sin "server-only" y sin importar prisma: recibe el cliente de base (o el
// `tx` de una transacción) como parámetro. Así lo usan cash.ts —que las
// pruebas cargan en Node pelado— y las transacciones del cobro.
// ═══════════════════════════════════════════════════════════════════════
import type { Prisma } from "@prisma/client";
import { isMissingColumnError } from "@/lib/barber/db-errors";

/** Marca de ticket cancelado (misma de commissions.ts; contrato-caja la vigila). */
const CANCELLED_MARK = "[CANCELADA]";

// ── La regla de la barbería ─────────────────────────────────────────────

export const LOYALTY_THRESHOLD_MIN = 1;
export const LOYALTY_THRESHOLD_MAX = 100;
export const LOYALTY_DEFAULT_THRESHOLD = 10;
export const LOYALTY_DEFAULT_REWARD = "Corte gratis";

export interface LoyaltyRule {
  /** La barbería tiene encendida la tarjeta de lealtad. */
  enabled: boolean;
  /** Cada cuántos sellos se gana el premio (1–100). */
  threshold: number;
  /** Etiqueta del premio. Nunca vacía. */
  reward: string;
}

export const DEFAULT_LOYALTY_RULE: LoyaltyRule = {
  enabled: true,
  threshold: LOYALTY_DEFAULT_THRESHOLD,
  reward: LOYALTY_DEFAULT_REWARD,
};

export function clampLoyaltyThreshold(value: unknown, fallback = LOYALTY_DEFAULT_THRESHOLD): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(LOYALTY_THRESHOLD_MAX, Math.max(LOYALTY_THRESHOLD_MIN, Math.round(n)));
}

/** Normaliza la fila de barber_shops a la regla. */
export function toLoyaltyRule(row: {
  loyaltyEnabled?: boolean | null;
  loyaltyThreshold?: number | null;
  loyaltyReward?: string | null;
} | null): LoyaltyRule {
  if (!row) return { ...DEFAULT_LOYALTY_RULE };
  const reward = (row.loyaltyReward ?? "").trim();
  return {
    enabled: row.loyaltyEnabled !== false,
    threshold: clampLoyaltyThreshold(row.loyaltyThreshold),
    reward: reward || LOYALTY_DEFAULT_REWARD,
  };
}

/** Clientes mínimos de Prisma que necesita este módulo (prisma o un tx). */
export type LoyaltyDb = Pick<
  Prisma.TransactionClient,
  "barbershop" | "barberClient" | "barberAppointment" | "barberSale" | "barberSaleItem"
>;

/**
 * La regla que configuró la barbería en Clientes → Ajustes (umbral, premio y
 * encendido). Si la base todavía no tiene esas columnas, los valores por
 * defecto: el módulo sigue funcionando.
 */
export async function getLoyaltyRule(db: LoyaltyDb, barbershopId: string): Promise<LoyaltyRule> {
  if (!barbershopId) return { ...DEFAULT_LOYALTY_RULE };
  try {
    const row = await db.barbershop.findUnique({
      where: { id: barbershopId },
      select: { loyaltyEnabled: true, loyaltyThreshold: true, loyaltyReward: true },
    });
    return toLoyaltyRule(row);
  } catch (e) {
    if (!isMissingColumnError(e)) {
      console.warn("[barber/loyalty] no se pudo leer la regla de lealtad:", (e as Error).message);
    }
    return { ...DEFAULT_LOYALTY_RULE };
  }
}

// ── La línea del ticket que se llevó el premio ──────────────────────────
//
// La caja marca el servicio canjeado con un sufijo en su descripción. Ese
// sufijo dice CUÁNTOS sellos costó, porque el umbral es configurable y puede
// cambiar: un canje hecho a 5 sellos sigue valiendo 5 aunque mañana la
// barbería suba el umbral a 10.

/** Sufijo histórico: los canjes anteriores a esta ola costaron 10 sellos. */
export const LOYALTY_SUFFIX = " · Gratis (lealtad)";
export const LOYALTY_LEGACY_STAMPS = 10;
/** Lo que comparten el sufijo histórico y el nuevo (para buscar en la base). */
export const LOYALTY_LINE_MARK = " · Gratis (lealtad";

const LOYALTY_LINE_RE = / · Gratis \(lealtad(?: · (\d{1,3}) sellos?)?\)$/;

/** Sufijo de la línea canjeada. Con 10 sellos es el de siempre. */
export function loyaltyLineSuffix(stamps: number): string {
  const n = clampLoyaltyThreshold(stamps);
  if (n === LOYALTY_LEGACY_STAMPS) return LOYALTY_SUFFIX;
  return ` · Gratis (lealtad · ${n} ${n === 1 ? "sello" : "sellos"})`;
}

/** Sellos que consumió esa línea, o null si no es una línea de canje. */
export function loyaltyStampsOfLine(description: string | null | undefined): number | null {
  if (typeof description !== "string") return null;
  const m = LOYALTY_LINE_RE.exec(description);
  if (!m) return null;
  return m[1] ? clampLoyaltyThreshold(Number(m[1])) : LOYALTY_LEGACY_STAMPS;
}

export function isLoyaltyLine(description: string | null | undefined): boolean {
  return loyaltyStampsOfLine(description) !== null;
}

// ── El recuento ─────────────────────────────────────────────────────────

/**
 * Un ticket cancelado no cuenta para nada: ni como visita ni como canje.
 * OJO Prisma: un `NOT { startsWith }` descarta las filas con notes NULL, así
 * que hace falta la rama explícita del null.
 */
export const NOT_CANCELLED: Prisma.BarberSaleWhereInput = {
  OR: [{ notes: null }, { NOT: { notes: { startsWith: CANCELLED_MARK } } }],
};

export interface BarberVisitTally {
  visits: number;
  lastVisitAt: Date | null;
  /** Sellos que YA consumió la caja canjeando premios desde el ticket. */
  cashRedeemedStamps: number;
}

/**
 * Cuántas veces se ha sentado de verdad cada cliente, para toda una tanda en
 * tres lecturas.
 *
 * Qué cuenta como visita:
 *   · Cita en DONE — la que pasó por la agenda.
 *   · Ticket SIN cita con al menos una línea de SERVICIO — el walk-in que
 *     llegó, se sentó y pagó. Un ticket de solo producto, la venta de una
 *     membresía o un anticipo NO son visita.
 * Las canceladas y los NO_SHOW no cuentan.
 */
export async function tallyVisits(
  db: LoyaltyDb,
  barbershopId: string,
  clientIds: string[],
): Promise<Map<string, BarberVisitTally>> {
  const out = new Map<string, BarberVisitTally>();
  if (!barbershopId || clientIds.length === 0) return out;

  const [appts, sales, redeemedLines] = await Promise.all([
    db.barberAppointment.groupBy({
      by: ["clientId"],
      where: { barbershopId, clientId: { in: clientIds }, status: "DONE" },
      _count: { _all: true },
      _max: { startAt: true },
    }),
    db.barberSale.groupBy({
      by: ["clientId"],
      where: {
        barbershopId,
        clientId: { in: clientIds },
        appointmentId: null,
        items: { some: { serviceId: { not: null } } },
        ...NOT_CANCELLED,
      },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    // Canjes hechos en la CAJA: cada línea marcada dice cuántos sellos costó.
    db.barberSaleItem.findMany({
      where: {
        description: { contains: LOYALTY_LINE_MARK },
        sale: { barbershopId, clientId: { in: clientIds }, ...NOT_CANCELLED },
      },
      select: { description: true, sale: { select: { clientId: true } } },
    }),
  ]);

  const blank = (): BarberVisitTally => ({ visits: 0, lastVisitAt: null, cashRedeemedStamps: 0 });

  const bump = (id: string | null, count: number, at: Date | null) => {
    if (!id) return;
    const prev = out.get(id) ?? blank();
    const nextAt = at && (!prev.lastVisitAt || at.getTime() > prev.lastVisitAt.getTime()) ? at : prev.lastVisitAt;
    out.set(id, { ...prev, visits: prev.visits + count, lastVisitAt: nextAt });
  };

  for (const g of appts) bump(g.clientId, g._count._all, g._max.startAt ?? null);
  for (const g of sales) bump(g.clientId, g._count._all, g._max.createdAt ?? null);

  for (const line of redeemedLines) {
    const id = line.sale.clientId;
    const stamps = loyaltyStampsOfLine(line.description);
    if (!id || stamps === null) continue;
    const prev = out.get(id) ?? blank();
    out.set(id, { ...prev, cashRedeemedStamps: prev.cashRedeemedStamps + stamps });
  }

  for (const id of clientIds) if (!out.has(id)) out.set(id, blank());
  return out;
}

/** Sellos ya consumidos por canjes hechos desde la FICHA (bitácora __loyalty). */
export function ledgerRedeemedVisits(preferences: unknown): number {
  const root = preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? (preferences as Record<string, unknown>)
    : {};
  const node = root.__loyalty && typeof root.__loyalty === "object" && !Array.isArray(root.__loyalty)
    ? (root.__loyalty as Record<string, unknown>)
    : {};
  const n = Number(node.redeemedVisits);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export interface LoyaltyCount {
  /** Sellos vivos: visitas − canjeados. Nunca negativo. */
  count: number;
  visits: number;
  lastVisitAt: Date | null;
}

/**
 * RECUENTA los sellos de esos clientes y refresca la caché (las columnas
 * loyaltyCount / totalVisits / lastVisitAt) solo donde cambió. Devuelve el
 * dato fresco, que es el que hay que enseñar y con el que hay que decidir.
 *
 * Es EL gancho: se llama al completar la visita, al cobrar y al cancelar un
 * ticket, y antes de leer el contador en la caja y en «mi cuenta». Llamarlo
 * de más es inocuo (en régimen normal no escribe nada).
 */
export async function refreshLoyalty(
  db: LoyaltyDb,
  barbershopId: string,
  clientIds: Array<string | null | undefined>,
): Promise<Map<string, LoyaltyCount>> {
  const out = new Map<string, LoyaltyCount>();
  const ids = Array.from(new Set(clientIds.filter((x): x is string => typeof x === "string" && x.length > 0)));
  if (!barbershopId || ids.length === 0) return out;

  const [rows, tallies] = await Promise.all([
    db.barberClient.findMany({
      where: { id: { in: ids }, barbershopId },
      select: { id: true, preferences: true, loyaltyCount: true, totalVisits: true, lastVisitAt: true },
    }),
    tallyVisits(db, barbershopId, ids),
  ]);

  for (const row of rows) {
    const tally = tallies.get(row.id) ?? { visits: 0, lastVisitAt: null, cashRedeemedStamps: 0 };
    const count = Math.max(0, tally.visits - ledgerRedeemedVisits(row.preferences) - tally.cashRedeemedStamps);
    out.set(row.id, { count, visits: tally.visits, lastVisitAt: tally.lastVisitAt });

    const sameDate =
      (row.lastVisitAt ? row.lastVisitAt.getTime() : null) === (tally.lastVisitAt ? tally.lastVisitAt.getTime() : null);
    if (row.loyaltyCount !== count || row.totalVisits !== tally.visits || !sameDate) {
      await db.barberClient.updateMany({
        where: { id: row.id, barbershopId },
        data: { loyaltyCount: count, totalVisits: tally.visits, lastVisitAt: tally.lastVisitAt },
      });
    }
  }
  return out;
}

/**
 * Igual que refreshLoyalty pero JAMÁS lanza: para los ganchos que corren
 * después de una operación que ya terminó bien (completar una visita). Un
 * fallo aquí solo deja la caché vieja; se corrige en la siguiente lectura.
 */
export async function refreshLoyaltySafe(
  db: LoyaltyDb,
  barbershopId: string,
  clientIds: Array<string | null | undefined>,
): Promise<void> {
  try {
    await refreshLoyalty(db, barbershopId, clientIds);
  } catch (e) {
    console.warn("[barber/loyalty] no se pudo refrescar el contador:", (e as Error).message);
  }
}
