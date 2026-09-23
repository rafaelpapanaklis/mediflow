/**
 * Qué cuenta como DINERO QUE ENTRÓ al saldo de IA de una clínica. Módulo PURO
 * (sin prisma, sin `server-only`).
 *
 * Es el MISMO criterio que el historial de facturas del panel de la clínica
 * (PR #402, `src/lib/billing/historial-facturas.ts`): una recarga se cobra con
 * un checkout `mode: "payment"`, que en Stripe es un CARGO y no una factura,
 * así que `stripe.invoices.list` no la devuelve y tampoco es una
 * `subscription_invoice`. La fuente es el libro mayor `ai_wallet_transactions`:
 *
 *  · TOPUP — entró por una pasarela; su `source` dice cuál (STRIPE,
 *    MERCADOPAGO, SPEI). Solo lo escriben los webhooks y la confirmación de un
 *    comprobante SPEI.
 *  · ADJUSTMENT con importe > 0 — abono a mano desde /admin/ai-billing (así se
 *    acreditó el pago de BEVADENT que el webhook no abonó). Un ADJUSTMENT
 *    negativo es un cargo del admin, no un pago: por eso el `gt: 0`.
 *  · CHARGE es consumo del bot y REFUND no lo escribe nadie hoy: fuera.
 *
 * Y aparte, las SPEI cuyo comprobante sigue en revisión (`ai_topups` PENDING,
 * método SPEI): la clínica dice que ya transfirió y el saldo aún no entra.
 * Cuando administración la confirma pasa a PAID y aparece su asiento TOPUP,
 * así que nunca se cuenta dos veces.
 *
 * Cuando el PR #402 esté en main, /admin puede importar estas dos funciones
 * de `@/lib/billing/historial-facturas` y borrar este archivo: son iguales a
 * propósito, para que /admin y el cliente cuenten lo mismo del mismo dinero.
 */

/** Por dónde entró el dinero de una recarga. */
export type ViaRecarga = "card" | "mercadopago" | "spei" | "manual";

export const ETIQUETA_VIA_RECARGA: Record<ViaRecarga, string> = {
  card: "Tarjeta (Stripe)",
  mercadopago: "Mercado Pago",
  spei: "SPEI",
  manual: "Abono registrado por DaleControl",
};

/** Qué asientos son dinero que ENTRÓ al saldo, sin la clínica. */
export const RECARGAS_DEL_SALDO = {
  OR: [
    { type: "TOPUP" as const },
    { type: "ADJUSTMENT" as const, amountCents: { gt: 0 } },
  ],
};

/** El `where` de la consulta: asientos que son dinero que ENTRÓ al saldo de ESA clínica. */
export function whereRecargasDelSaldo(clinicId: string) {
  return { clinicId, ...RECARGAS_DEL_SALDO };
}

const VIA_POR_ORIGEN: Record<string, ViaRecarga> = {
  STRIPE: "card",
  MERCADOPAGO: "mercadopago",
  SPEI: "spei",
};

/** null si el asiento no es una recarga (consumo, cargo del admin, reembolso). */
export function viaDeRecarga(m: { type: string; amountCents: number; source: string }): ViaRecarga | null {
  if (!(m.amountCents > 0)) return null;
  if (m.type === "ADJUSTMENT") return "manual";
  if (m.type === "TOPUP") return VIA_POR_ORIGEN[m.source] ?? "manual";
  return null;
}
