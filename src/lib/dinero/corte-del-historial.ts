// El detalle de un corte CERRADO del historial, para que sume a la vista
// (tercera auditoría de uso, F3, 4-oct-2026). Puro, client-safe.
//
// El corte guarda una foto al cerrar (apertura, efectivo, otros, descuentos,
// IVA, retiros, esperado, contado, diferencia) pero NO los reembolsos en
// efectivo, que sí restan del esperado (expectedCashOf). El detalle enseñaba
// «Apertura $5,300 · Efectivo $3,800 · Esperado $8,400» sin el −$700 que
// faltaba. Esa cifra sale de la misma foto: es lo único que separa el
// esperado de apertura + efectivo − retiros.

export interface FotoDelCorte {
  openingBalance: number | null;
  cashIncome: number | null;
  withdrawals: number | null;
  expectedCash: number | null;
}

/**
 * Lo que salió del cajón por reembolsos en efectivo durante el turno (positivo),
 * deducido de la foto del corte. 0 si la foto está incompleta o no hubo.
 */
export function reembolsosEnEfectivoDelCorte(h: FotoDelCorte): number {
  if (h.openingBalance == null || h.cashIncome == null || h.expectedCash == null) return 0;
  const c = Math.round(h.openingBalance * 100) + Math.round(h.cashIncome * 100)
    - Math.round((h.withdrawals ?? 0) * 100) - Math.round(h.expectedCash * 100);
  return c > 0 ? c / 100 : 0;
}

/** Lo que se calcula al abrir el detalle (no está en la foto): movimientos del turno sin dinero en el cajón. */
export interface MovimientosDelCorte {
  /** Reembolsos de cualquier método (dinero que salió), positivo. */
  refunds: number;
  /** Traspasos a saldo a favor (no sale dinero). */
  toCredit: number;
  /** Saldo a favor aplicado a facturas (no entra dinero). */
  appliedCredit: number;
  /** Bajas del total que no son descuento (reembolso por cobro de más, resto dado de baja). */
  writeOffs: number;
}
