// Ortodoncia — ws1-t4 #73: la cabecera de la ficha decía «$23,000 · Pendiente»
// en rojo con el paciente al corriente. Puro y client-safe.

import { fmtMoney } from "@/components/specialties/orthodontics/redesign/atoms/format";

/**
 * «Vencido $X» si algo venció; «Al corriente» si debe pero nada venció; «Al día» si no debe nada.
 * ws1-t4: con saldo a favor del paciente (su libro, la cifra de su resumen), se añade «· a favor $X».
 */
export function subDelSaldo(saldo: number | null, vencido: number | null | undefined, aFavor?: number | null): string {
  const extra = (aFavor ?? 0) > 0 ? ` · a favor ${fmtMoney(aFavor ?? 0)}` : "";
  if (saldo == null) return `Sin plan de pago${extra}`;
  if ((vencido ?? 0) > 0) return `Vencido ${fmtMoney(vencido ?? 0)}${extra}`;
  return `${saldo > 0 ? "Al corriente" : "Al día"}${extra}`;
}
