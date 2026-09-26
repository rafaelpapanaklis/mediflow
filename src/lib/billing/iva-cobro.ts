/**
 * IVA 16 % de los pagos NUEVOS de un plan (tarjeta, OXXO y SPEI) — núcleo PURO
 * (sin prisma ni Stripe: lo importa también el cliente).
 *
 * DECISIÓN (Rafael): el IVA lo suma NUESTRO código, no Stripe Tax. Tarjeta y OXXO
 * llevan una TASA DE IMPUESTO MANUAL de Stripe («IVA 16 %», exclusiva, MX) en la
 * línea del plan: Stripe calcula el IVA, lo desglosa en recibo y factura y rellena
 * `total_details.amount_tax` (así `amount_total − amount_tax` sigue dando el valor
 * SIN IVA, que es lo que usa la conversión de Google Ads). El id de la tasa sale
 * del env STRIPE_IVA_TAX_RATE_ID (Rafael la crea en el dashboard de Stripe; el
 * código NUNCA crea nada en Stripe). SPEI directo suma el mismo 16 % por su
 * cuenta (ver spei-directo-core).
 *
 * SOLO aplica a sesiones NUEVAS. Ninguna suscripción existente se toca: ni se
 * actualiza, ni se migra, ni se cancela; sus renovaciones siguen cobrando lo de hoy.
 */

/** IVA general en México. Es una tasa fiscal, no un precio de plan. */
export const IVA_TASA_PCT = 16;
export const IVA_TASA = IVA_TASA_PCT / 100;

/**
 * IVA de un subtotal en centavos: sobre el subtotal, redondeado al centavo
 * (mitad hacia arriba), como lo calcula Stripe con una tasa exclusiva. Aritmética
 * entera: sin errores de coma flotante.
 */
export function ivaDeSubtotalCents(subtotalCents: number): number {
  return Math.floor((Math.round(subtotalCents) * IVA_TASA_PCT + 50) / 100);
}

export interface DesgloseIva {
  subtotalCents: number;
  ivaCents: number;
  totalCents: number;
}

export function desgloseConIva(subtotalCents: number): DesgloseIva {
  const s = Math.round(subtotalCents);
  const ivaCents = ivaDeSubtotalCents(s);
  return { subtotalCents: s, ivaCents, totalCents: s + ivaCents };
}

/** Forma de un id de tasa de Stripe: txr_ + alfanumérico. Evita pegar en Vercel un id de otro tipo. */
export function esIdDeTasa(v: string | undefined | null): v is string {
  return typeof v === "string" && /^txr_[A-Za-z0-9]{8,}$/.test(v.trim());
}

export const CODIGO_IVA_NO_CONFIGURADO = "IVA_NO_CONFIGURADO";
export const MENSAJE_IVA_NO_CONFIGURADO =
  "El cobro con tarjeta y OXXO no está disponible por ahora (falta configurar el IVA). Paga por transferencia SPEI o escríbenos a soporte.";

/**
 * Qué IVA lleva una sesión nueva de cobro por plan:
 *  · `STRIPE_AUTOMATIC_TAX === "true"` → Stripe Tax (`automatic_tax`); NO se añade la tasa manual
 *    (Stripe rechaza las dos a la vez y el IVA se sumaría doble).
 *  · si no, la tasa manual `STRIPE_IVA_TAX_RATE_ID` en la línea del plan (`tax_rates`);
 *  · sin ninguna de las dos → `ok: false`: NO se cobra sin IVA en silencio (el llamador responde 503).
 */
export type IvaParaCobro =
  | { ok: true; modo: "automatico" | "tasa"; sesion: { automatic_tax?: { enabled: true }; customer_update?: { address: "auto" } }; linea: { tax_rates?: string[] } }
  | { ok: false; codigo: typeof CODIGO_IVA_NO_CONFIGURADO; error: string };

export function ivaParaCobro(env: Record<string, string | undefined>): IvaParaCobro {
  if (env.STRIPE_AUTOMATIC_TAX === "true") {
    // Stripe Tax necesita la dirección del cliente para calcular el impuesto.
    return { ok: true, modo: "automatico", sesion: { automatic_tax: { enabled: true }, customer_update: { address: "auto" } }, linea: {} };
  }
  const id = env.STRIPE_IVA_TAX_RATE_ID?.trim();
  if (esIdDeTasa(id)) return { ok: true, modo: "tasa", sesion: {}, linea: { tax_rates: [id] } };
  return { ok: false, codigo: CODIGO_IVA_NO_CONFIGURADO, error: MENSAJE_IVA_NO_CONFIGURADO };
}
