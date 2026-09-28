// Ortodoncia — ws1-t4 #77: en «Pago por control» cada visita es su propia
// factura. La ficha lista los controles que se DEBEN, uno por uno, con su
// «Cobrar»; el «Cobrar» de arriba abre el primero, no la colocación ya pagada.
// Puro.

import type { CargoDeControl } from "../cobranza-caso";

export interface ControlPorCobrar {
  invoiceId: string;
  invoiceNumber: string | null;
  total: number;
  paid: number;
  balance: number;
  status: string;
  /** "YYYY-MM-DD" */
  vencimiento: string;
}

/** Los cargos de control con saldo, del más viejo al más nuevo. Una cancelada o pagada no se debe. */
export function controlesPorCobrarDe(cargos: readonly CargoDeControl[]): ControlPorCobrar[] {
  return cargos
    .filter((c) => c.status !== "CANCELLED" && c.status !== "PAID" && c.total - c.pagado > 0.004)
    .map((c) => ({
      invoiceId: c.invoiceId,
      invoiceNumber: c.invoiceNumber,
      total: c.total,
      paid: c.pagado,
      balance: Math.round((c.total - c.pagado) * 100) / 100,
      status: c.status,
      vencimiento: c.vencimiento,
    }))
    .sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));
}
