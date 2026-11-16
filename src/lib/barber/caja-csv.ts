// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — CSV de Caja (ws6-t1): «Cortes» y «Gastos».
//
// Puro (sin prisma): recibe las filas ya calculadas por el servidor (el
// resumen único de caja-resumen.ts), así el CSV dice EXACTAMENTE lo mismo
// que la pantalla y el corte impreso. UTF-8 con BOM y CRLF para que Excel
// abra los acentos; números sin formato de moneda (se pueden sumar).
// Un texto que empieza con = + - @ se antepone con ' (no corre como fórmula).
// ═══════════════════════════════════════════════════════════════════════
import type { CorteRow } from "@/lib/barber/cash";
import type { CashMovementRow } from "@/lib/barber/cash-movements";

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(cell).join(",");
}

export function toCsv(rows: unknown[][]): string {
  return String.fromCharCode(0xfeff) + rows.map(csvLine).join("\r\n") + "\r\n";
}

/** «2026-11-16 21:05» en la zona de la barbería (orden natural en la hoja). */
export function csvDateTime(iso: string | null, tz: string): string {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: tz,
    }).formatToParts(new Date(iso));
    const p = (k: string) => parts.find((x) => x.type === k)?.value ?? "";
    return `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}`;
  } catch {
    return iso;
  }
}

/** Encabezados de «Cortes» (en el idioma de la barbería). */
export interface CortesCsvLabels {
  opened: string;
  closed: string;
  openedBy: string;
  closedBy: string;
  opening: string;
  cashCharged: string;
  cashIn: string;
  cashExpenses: string;
  withdrawals: string;
  cashPayouts: string;
  cashRefunds: string;
  expected: string;
  counted: string;
  difference: string;
  leftForNext: string;
  income: string;
  card: string;
  transfer: string;
  online: string;
  tips: string;
  tickets: string;
  expensesAll: string;
  notes: string;
}

/** Una fila por corte. Esperado/contado de un corte cerrado son los CONGELADOS al cerrar. */
export function cortesCsv(rows: CorteRow[], L: CortesCsvLabels, tz: string): string {
  const out: unknown[][] = [
    [L.opened, L.closed, L.openedBy, L.closedBy, L.opening, L.cashCharged, L.cashIn, L.cashExpenses, L.withdrawals, L.cashPayouts, L.cashRefunds, L.expected, L.counted, L.difference, L.leftForNext, L.income, L.card, L.transfer, L.online, L.tips, L.tickets, L.expensesAll, L.notes],
  ];
  for (const r of rows) {
    const e = r.resumen.esperado;
    out.push([
      csvDateTime(r.openedAt, tz),
      csvDateTime(r.closedAt, tz),
      r.openedByName,
      r.closedByName ?? "",
      e.opening,
      e.cashCharged,
      e.cashIn,
      e.cashExpenses,
      e.withdrawals,
      e.cashPayouts,
      e.cashRefunds,
      r.expectedAmount ?? e.expected,
      r.countedAmount ?? "",
      r.difference ?? "",
      r.leftForNext ?? "",
      r.resumen.income.total,
      r.resumen.income.byMethod.CARD.total,
      r.resumen.income.byMethod.SPEI.total,
      r.resumen.income.byMethod.ONLINE.total,
      r.resumen.tips.total,
      r.resumen.tickets.count,
      r.resumen.expenses.total,
      r.notes ?? "",
    ]);
  }
  return toCsv(out);
}

export interface GastosCsvLabels {
  date: string;
  category: string;
  amount: string;
  method: string;
  note: string;
  who: string;
  inRegister: string;
  yes: string;
  no: string;
  voided: string;
  categoryOf: (c: string | null) => string;
  methodOf: (m: string) => string;
}

/** Una fila por gasto VIVO (los anulados no suman y no se exportan). */
export function gastosCsv(items: CashMovementRow[], L: GastosCsvLabels, tz: string): string {
  const out: unknown[][] = [[L.date, L.category, L.amount, L.method, L.note, L.who, L.inRegister]];
  for (const m of items) {
    if (m.voidedAt) continue;
    out.push([csvDateTime(m.createdAt, tz), L.categoryOf(m.category), m.amount, L.methodOf(m.method), m.note ?? "", m.createdByName, m.sessionId ? L.yes : L.no]);
  }
  return toCsv(out);
}
