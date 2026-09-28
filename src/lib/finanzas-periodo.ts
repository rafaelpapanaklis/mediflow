import { MX_OFFSET_MS } from "@/lib/analytics/query";

// ═══════════════════════════════════════════════════════════════════
// Piezas puras que comparten /api/finanzas y /api/gastos, para que la
// tarjeta «Gastos», la utilidad y la lista de gastos hablen SIEMPRE de la
// misma población. Sin Prisma ni red: se prueban solas
// (src/lib/__tests__/finanzas-periodo.test.ts).
// ═══════════════════════════════════════════════════════════════════

/**
 * Estados de factura que NO son una venta: el borrador (DRAFT) todavía no se
 * confirma — no se puede cobrar ni enviar — y la cancelada ya no existe. Es el
 * mismo criterio que `receivableInvoiceWhere` en caja.ts y que el CFDI.
 */
export const NOT_A_SALE_STATUSES = ["DRAFT", "CANCELLED"] as const;

/**
 * Hasta dónde llegan los GASTOS del periodo.
 *
 * Un cobro no puede tener fecha futura, pero un gasto sí: el día 5 se registra
 * la renta con fecha del 30. Con la ventana de «este mes» cortada en *ahora*,
 * ese gasto no salía en la lista ni restaba de la utilidad hasta el día 30. Por
 * eso, SOLO para gastos y SOLO en «mes», la ventana llega al último instante
 * del mes natural de México. En los demás periodos se respeta `to` tal cual
 * («hoy» guarda la fecha a las 00:00 MX, así que ya entra; «mes_anterior» y
 * «custom» ya son ventanas cerradas).
 */
export function expenseWindowEnd(period: string | null, now: Date, to: Date): Date {
  if (period === "hoy" || period === "mes_anterior" || period === "custom") return to;
  const mx = new Date(now.getTime() - MX_OFFSET_MS);
  const nextMonthStart = Date.UTC(mx.getUTCFullYear(), mx.getUTCMonth() + 1, 1) + MX_OFFSET_MS;
  return new Date(nextMonthStart - 1);
}

/**
 * Hasta dónde llega la serie diaria: hasta `to`, o hasta el último gasto si hay
 * alguno posterior. Así la suma de `serie[].gastos` sigue siendo el KPI de
 * gastos, y una clínica SIN gastos futuros recibe exactamente la misma serie
 * que antes (no se le alarga la gráfica con días vacíos).
 */
export function serieEnd(to: Date, expenseDates: Date[]): Date {
  let end = to;
  for (const d of expenseDates) if (d > end) end = d;
  return end;
}

// ── La ventana del periodo ─────────────────────────────────────────
// Vivía dentro de /api/finanzas. Salió aquí para que el bloque «Ortodoncia»
// (/api/finanzas/ortodoncia) hable EXACTAMENTE del mismo periodo que el resto
// de la pantalla: misma función, no una copia.

/** Inicio del día natural de México para `now`, como instante UTC. */
export function startOfTodayMx(now: Date): Date {
  const mx = new Date(now.getTime() - MX_OFFSET_MS);
  return new Date(Date.UTC(mx.getUTCFullYear(), mx.getUTCMonth(), mx.getUTCDate()) + MX_OFFSET_MS);
}

/** Día 1 del mes de México (con delta de meses), como instante UTC. */
export function startOfMonthMx(now: Date, monthDelta = 0): Date {
  const mx = new Date(now.getTime() - MX_OFFSET_MS);
  return new Date(Date.UTC(mx.getUTCFullYear(), mx.getUTCMonth() + monthDelta, 1) + MX_OFFSET_MS);
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La ventana [from, to] del periodo pedido: `hoy`, `mes` (default y cualquier
 * valor desconocido), `mes_anterior` o `custom` con `from`/`to` "YYYY-MM-DD".
 */
export function resolveFinanzasWindow(
  sp: { get(name: string): string | null },
  now: Date = new Date(),
): { from: Date; to: Date } | { error: string } {
  const period = sp.get("period") ?? "mes";
  if (period === "hoy") return { from: startOfTodayMx(now), to: now };
  if (period === "mes_anterior") {
    const currentStart = startOfMonthMx(now, 0);
    return { from: startOfMonthMx(now, -1), to: new Date(currentStart.getTime() - 1) };
  }
  if (period === "custom") {
    const fromRaw = sp.get("from") ?? "";
    const toRaw = sp.get("to") ?? "";
    if (!DATE_ONLY_RE.test(fromRaw) || !DATE_ONLY_RE.test(toRaw)) {
      return { error: "period=custom requiere from y to en formato YYYY-MM-DD." };
    }
    // Fecha sin hora = día natural de México (-06:00), igual que analytics/query.ts.
    const from = new Date(`${fromRaw}T00:00:00.000-06:00`);
    const to = new Date(`${toRaw}T23:59:59.999-06:00`);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
      return { error: "Rango de fechas inválido (from debe ser <= to)." };
    }
    return { from, to };
  }
  // "mes" (default y cualquier valor desconocido): del día 1 MX a ahora.
  return { from: startOfMonthMx(now, 0), to: now };
}
