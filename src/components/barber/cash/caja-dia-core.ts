// La lista ÚNICA del día de Caja (ws6-t1): tickets, gastos, retiros,
// entradas, pagos a barberos y anticipos, en orden de hora, con quién lo
// hizo. Puro y client-safe (sin React ni servidor) para poder probarlo.
import type { SaleRow } from "@/lib/barber/cash";
import type { CashMovementRow } from "@/lib/barber/cash-movements";

/** Filtros de la lista, en el orden en que salen los botones. */
export const DAY_FILTERS = ["all", "tickets", "expenses", "withdrawals", "deposits", "payouts", "advances"] as const;
export type DayFilter = (typeof DAY_FILTERS)[number];

export type DayRow =
  | {
      source: "sale";
      id: string;
      at: string;
      /** Grupo del filtro: un anticipo o su devolución van en «anticipos». */
      group: Exclude<DayFilter, "all">;
      who: string;
      cancelled: boolean;
      sale: SaleRow;
    }
  | {
      source: "movement";
      id: string;
      at: string;
      group: Exclude<DayFilter, "all">;
      who: string;
      cancelled: boolean;
      movement: CashMovementRow;
    };

function groupOfSale(s: Pick<SaleRow, "kind">): Exclude<DayFilter, "all"> {
  return s.kind === "deposit" || s.kind === "refund" ? "advances" : "tickets";
}

function groupOfMovement(m: Pick<CashMovementRow, "type">): Exclude<DayFilter, "all"> {
  switch (m.type) {
    case "EXPENSE":
      return "expenses";
    case "WITHDRAWAL":
      return "withdrawals";
    case "DEPOSIT":
      return "deposits";
    default:
      return "payouts";
  }
}

/** Junta tickets y movimientos en una sola lista, de la hora más temprana a la más tarde. */
export function buildDayRows(sales: SaleRow[], movements: CashMovementRow[]): DayRow[] {
  const rows: DayRow[] = [
    ...sales.map(
      (s): DayRow => ({ source: "sale", id: s.id, at: s.createdAt, group: groupOfSale(s), who: s.soldByName, cancelled: s.cancelled, sale: s }),
    ),
    ...movements.map(
      (m): DayRow => ({
        source: "movement",
        id: m.id,
        at: m.createdAt,
        group: groupOfMovement(m),
        who: m.createdByName,
        cancelled: m.voidedAt !== null,
        movement: m,
      }),
    ),
  ];
  return rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}

export function filterDayRows(rows: DayRow[], filter: DayFilter): DayRow[] {
  return filter === "all" ? rows : rows.filter((r) => r.group === filter);
}

/** Cuántos renglones hay por filtro (para no enseñar botones vacíos). */
export function countByFilter(rows: DayRow[]): Record<DayFilter, number> {
  const out = Object.fromEntries(DAY_FILTERS.map((f) => [f, 0])) as Record<DayFilter, number>;
  out.all = rows.length;
  for (const r of rows) out[r.group] += 1;
  return out;
}

/**
 * Efecto del renglón en el cajón (+ entra, − sale, 0 no toca el efectivo).
 * Solo para el signo que se enseña; la cuenta la hace el servidor.
 */
export function drawerEffect(row: DayRow): -1 | 0 | 1 {
  if (row.cancelled) return 0;
  if (row.source === "sale") {
    if (row.sale.paymentMethod !== "CASH") return 0;
    return row.sale.total < 0 ? -1 : 1;
  }
  const m = row.movement;
  if (m.method !== "CASH") return 0;
  return m.type === "DEPOSIT" ? 1 : -1;
}

/** "2026-11-16" del instante en la zona de la barbería. */
export function dayKeyInTz(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** ¿La caja abierta es de otro día (ayer o antes) en la zona de la barbería? */
export function isStaleSession(openedAt: string, now: Date, tz: string): boolean {
  return dayKeyInTz(openedAt, tz) < dayKeyInTz(now.toISOString(), tz);
}
