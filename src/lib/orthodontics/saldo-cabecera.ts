// Ortodoncia — ws1-t4 #73: la cabecera de la ficha decía «$23,000 · Pendiente»
// en rojo con el paciente al corriente. Puro y client-safe.

import { fmtMoney } from "@/components/specialties/orthodontics/redesign/atoms/format";

/** «Vencido $X» si algo venció; «Al corriente» si debe pero nada venció; «Al día» si no debe nada. */
export function subDelSaldo(saldo: number | null, vencido: number | null | undefined): string {
  if (saldo == null) return "Sin plan de pago";
  if ((vencido ?? 0) > 0) return `Vencido ${fmtMoney(vencido ?? 0)}`;
  return saldo > 0 ? "Al corriente" : "Al día";
}
