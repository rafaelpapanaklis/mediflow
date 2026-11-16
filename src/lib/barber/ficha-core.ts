/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — la ficha del cliente «A» (pestañas), parte PURA.
 *
 * Sin Prisma ni React: qué pestañas salen, cuál está abierta según la
 * dirección (?tab=pagos, y #pagos como antes), cómo se arma el enlace a una
 * pestaña y la próxima cita a partir del historial que ya trae la ficha.
 * Lo prueba src/lib/barber/__tests__/ficha-pestanas.test.ts.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const FICHA_TABS = ["resumen", "corte", "pagos", "fotos", "historial", "membresia"] as const;
export type FichaTab = (typeof FICHA_TABS)[number];

/** Nombres viejos o del mockup que siguen abriendo la pestaña correcta. */
const ALIAS: Record<string, FichaTab> = {
  cobros: "pagos",
  tickets: "pagos",
  facturas: "pagos",
  preferencias: "corte",
  estrellas: "historial",
  membresias: "membresia",
};

export function normalizeFichaTab(raw: string | null | undefined): FichaTab | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/^#/, "");
  if (!key) return null;
  if ((FICHA_TABS as readonly string[]).includes(key)) return key as FichaTab;
  return ALIAS[key] ?? null;
}

/** Qué pestañas existen para ESTE cliente y ESTA sesión. */
export function visibleFichaTabs(opts: {
  /** El servidor dejó ver sus cobros (cash.view, o el Barbero en un cliente suyo). */
  canSeePayments: boolean;
  /** Tiene una membresía vigente o la tuvo. */
  hasMembership: boolean;
  /** Plan con membresías y permiso memberships.sell. */
  canSellMembership: boolean;
}): FichaTab[] {
  return FICHA_TABS.filter((tab) => {
    if (tab === "pagos") return opts.canSeePayments;
    if (tab === "membresia") return opts.hasMembership || opts.canSellMembership;
    return true;
  });
}

/**
 * La pestaña abierta: manda ?tab=; si no hay, el #ancla de antes (#pagos,
 * #cobros); si la pedida no existe para esta sesión, el Resumen.
 */
export function resolveFichaTab(
  input: { tab?: string | null; hash?: string | null },
  available: readonly FichaTab[],
): FichaTab {
  const wanted = normalizeFichaTab(input.tab) ?? normalizeFichaTab(input.hash);
  if (wanted && available.includes(wanted)) return wanted;
  return "resumen";
}

/**
 * La dirección de una pestaña conservando los demás parámetros (?ya=1…).
 * El Resumen no lleva ?tab= (la dirección limpia es la de siempre).
 */
export function fichaTabSearch(currentSearch: string, tab: FichaTab): string {
  const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  if (tab === "resumen") params.delete("tab");
  else params.set("tab", tab);
  const out = params.toString();
  return out ? `?${out}` : "";
}

/** Pestaña siguiente / anterior con las flechas (da la vuelta). */
export function stepFichaTab(available: readonly FichaTab[], current: FichaTab, delta: 1 | -1): FichaTab {
  const i = Math.max(0, available.indexOf(current));
  const n = available.length;
  return available[(i + delta + n) % n];
}

// ── Próxima cita (del historial que ya llegó: incluye las futuras) ──────

const UPCOMING_STATUSES = new Set(["PENDING", "CONFIRMED"]);

export function nextAppointmentOf<T extends { kind: string; at: string; status: string | null }>(
  entries: readonly T[],
  now: Date = new Date(),
): T | null {
  let best: T | null = null;
  for (const e of entries) {
    if (e.kind !== "appointment" || !e.status || !UPCOMING_STATUSES.has(e.status)) continue;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at) || at < now.getTime()) continue;
    if (!best || at < Date.parse(best.at)) best = e;
  }
  return best;
}

// ── Marca de un ticket cancelado ────────────────────────────────────────
//
// cancelSale (cash.ts) escribe en la primera línea de notes:
//   «<CANCELLED_MARK> <ISO> · <quién> · <motivo> · Original: <lo que llevaba>»
// Aquí se lee quién y por qué, para pintarlo en Pagos sin otra consulta.

export function cancelInfoOf(
  notes: string | null | undefined,
  mark: string,
): { at: string | null; by: string | null; reason: string | null } | null {
  if (typeof notes !== "string" || !notes.startsWith(mark)) return null;
  let rest = notes.split("\n")[0].slice(mark.length).trim();
  const original = rest.lastIndexOf(" · Original: ");
  if (original >= 0) rest = rest.slice(0, original);
  const parts = rest.split(" · ");
  const at = parts.length > 0 && /^\d{4}-\d{2}-\d{2}T/.test(parts[0]) ? parts.shift() ?? null : null;
  const by = parts.length > 1 ? (parts.shift() ?? "").trim() || null : null;
  const reason = parts.join(" · ").trim() || null;
  return { at, by, reason };
}

/** El folio corto que imprime el ticket (#3F9A2C). */
export function ticketShortId(id: string): string {
  return id.slice(-6).toUpperCase();
}

// ── Filtros de la lista de tickets en Pagos ─────────────────────────────

export const SALES_STATUS_FILTERS = ["all", "paid", "cancelled"] as const;
export const SALES_PERIOD_FILTERS = ["all", "30d", "90d", "year"] as const;
export const SALES_METHOD_FILTERS = ["all", "CASH", "CARD", "SPEI", "STRIPE"] as const;

export interface ClientSalesFilter {
  status: (typeof SALES_STATUS_FILTERS)[number];
  period: (typeof SALES_PERIOD_FILTERS)[number];
  method: (typeof SALES_METHOD_FILTERS)[number];
}

export const NO_SALES_FILTER: ClientSalesFilter = { status: "all", period: "all", method: "all" };

function pick<T extends readonly string[]>(list: T, raw: unknown): T[number] {
  return typeof raw === "string" && (list as readonly string[]).includes(raw) ? (raw as T[number]) : list[0];
}

/** Lo que llega por la dirección (?estado=&periodo=&metodo=); lo raro se ignora. */
export function parseClientSalesFilter(get: (key: string) => string | null): ClientSalesFilter {
  return {
    status: pick(SALES_STATUS_FILTERS, get("estado")),
    period: pick(SALES_PERIOD_FILTERS, get("periodo")),
    method: pick(SALES_METHOD_FILTERS, get("metodo")),
  };
}

export function clientSalesFilterQuery(f: ClientSalesFilter): string {
  const out: string[] = [];
  if (f.status !== "all") out.push(`estado=${f.status}`);
  if (f.period !== "all") out.push(`periodo=${f.period}`);
  if (f.method !== "all") out.push(`metodo=${f.method}`);
  return out.join("&");
}

/** Desde cuándo cuenta el periodo (null = todo el tiempo). */
export function salesPeriodStart(period: ClientSalesFilter["period"], now: Date = new Date()): Date | null {
  if (period === "30d") return new Date(now.getTime() - 30 * 86_400_000);
  if (period === "90d") return new Date(now.getTime() - 90 * 86_400_000);
  if (period === "year") return new Date(now.getTime() - 365 * 86_400_000);
  return null;
}
