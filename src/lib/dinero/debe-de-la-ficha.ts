// El «Debe» de la ficha del paciente: UNA regla, que usan la ficha (patient-detail-client.tsx, en el
// navegador) y el servidor (`debeDelPaciente`: «Debe hoy» del detalle de la cita). PURO.
//
// v18 (revisión t5 de la v17, m1): Debe = saldo de sus facturas que no estén CANCELADAS — los BORRADORES
// (DRAFT) incluidos — menos lo que aún no se debe (`loQueAunNoSeDebe`), nunca menos de 0.
//
// Por qué cuentan los borradores: el único que nace en borrador es la factura que «Nueva consulta» arma
// con los procedimientos con precio de fuera del plan (POST /api/clinical, `autoInvoice`): trabajo YA
// hecho en la consulta. Queda en borrador solo para que recepción la ajuste y la confirme antes de
// cobrarla («Cobrar ahora» de la ficha va primero a ella). El plan, el presupuesto, «Cobrar hoy», la cita
// y la ortodoncia crean sus notas ya emitidas (PENDING). Así, en la recepción, «¿cuánto le cobro hoy?»
// incluye lo de la consulta de hoy aunque aún no esté confirmado.

import { isVoidedInvoice } from "@/components/dashboard/billing/invoice-status";

/** ¿Esta factura entra en el «Debe» de la ficha? Todo menos las canceladas (el borrador sí). */
export const cuentaEnElDebeDeLaFicha = (inv: { status?: string | null }): boolean => !isVoidedInvoice(inv);

/** Debe = saldo − lo que aún no se debe, en centavos exactos y nunca negativo. */
export function debeDeLaFicha(saldo: number, aunNoSeDebe: number): number {
  return Math.max(0, Math.round((saldo - aunNoSeDebe) * 100) / 100);
}
