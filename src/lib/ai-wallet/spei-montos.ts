/**
 * Topes y formato del monto de una recarga de saldo IA por SPEI. Separado de
 * `spei-solicitud.ts` a propósito: esto lo importa la pantalla (cliente), y
 * aquello arrastra los diccionarios completos de i18n, que no deben viajar al
 * navegador.
 */

/** Mismos topes que `/api/ai-wallet/spei/topup` (centavos MXN). */
export const SPEI_MIN_CENTS = 5_000; // $50 MXN
export const SPEI_MAX_CENTS = 50_000_000; // $500,000 MXN

/** Centavos enteros dentro de los topes, o `null`. */
export function montoSpeiValido(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < SPEI_MIN_CENTS || n > SPEI_MAX_CENTS) return null;
  return n;
}

/** «$1,500.00 MXN» — el mismo formato en los dos idiomas: es dinero mexicano. */
export function montoMxn(cents: number): string {
  const pesos = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
  return `${pesos} MXN`;
}
