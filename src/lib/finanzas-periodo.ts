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
