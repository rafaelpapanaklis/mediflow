import { centavosAMxn } from "@/lib/billing/spei-directo-core";

/**
 * Textos de la promo del primer mes (solo tarjeta). Decisión de Rafael (6-oct-2026): la promo NO se
 * extiende a SPEI ni a OXXO; lo que hay que lograr es que se ENTIENDA. Los montos entran como
 * argumentos (la promo sale de FIRST_MONTH_PROMO_MXN, el precio del plan de plan_configs): aquí no
 * hay ninguna cifra escrita a mano. Solo para la compra mensual de una primera contratación; los
 * enlaces /contratar, el anual y las clínicas que ya pagaron no los usan.
 */

const pesos = (n: number) => "$" + Math.round(n).toLocaleString("es-MX");

/** Primer mes con tarjeta junto al precio normal (paso 3 del alta y tarjeta del plan mensual). */
export function lineaPrimerMesConTarjeta(args: { promoMxn: number; precioMensualMxn: number; conIva?: boolean }): string {
  return `Tu primer mes con tarjeta: ${pesos(args.promoMxn)} (IVA incluido) · después ${pesos(args.precioMensualMxn)}${args.conIva === false ? "" : " + IVA"} al mes`;
}

/** La parte «después» sola, para cuando la cifra grande ya es la promo. */
export function lineaDespuesDelPrimerMes(args: { precioMensualMxn: number; conIva?: boolean }): string {
  return `Después ${pesos(args.precioMensualMxn)}${args.conIva === false ? "" : " + IVA"} al mes`;
}

/** Aviso al elegir SPEI u OXXO: la promo es solo con tarjeta y lo que se paga ahí es el mes completo. */
export function avisoPromoSoloConTarjeta(args: { promoMxn: number; totalCompletoCents: number; metodo: "spei" | "oxxo" }): string {
  const como = args.metodo === "spei" ? "transferencia" : "OXXO";
  return `La promoción del primer mes (${pesos(args.promoMxn)}, IVA incluido) es solo con tarjeta. Con ${como} pagas el mes completo: ${centavosAMxn(args.totalCompletoCents)}.`;
}

export function botonPagarConTarjetaPromo(promoMxn: number): string {
  return `Pagar con tarjeta por ${pesos(promoMxn)}`;
}
