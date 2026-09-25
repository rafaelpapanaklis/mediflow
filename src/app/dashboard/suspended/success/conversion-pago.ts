/**
 * Conversión «Pago completado» de Google Ads (WS1-T3) — el NÚCLEO PURO.
 *
 * Decide si la vuelta de Stripe a /dashboard/suspended/success debe mandar la
 * conversión al navegador, y con qué datos. Aquí no hay red ni base: la página
 * (server component) trae la sesión de Checkout desde Stripe con
 * `conversion-pago.server.ts` y esta función la juzga. Así se prueba con
 * `tsx --test` sin Stripe.
 *
 * REGLAS (todas tienen que cumplirse; si una falla, no hay conversión y la
 * página de éxito se pinta exactamente igual):
 *   1. La clínica ya está ACTIVADA en la BD (`activada`): lo escribió el
 *      webhook, no la URL.
 *   2. El `session_id` de la URL tiene forma de sesión de Checkout (cs_…).
 *      Un id inventado ni siquiera viaja a Stripe.
 *   3. Stripe devuelve la sesión y `metadata.clinicId` es la clínica de la
 *      SESIÓN DEL USUARIO (el clinicId sale de getCurrentUser, nunca de la URL).
 *      Un session_id ajeno pegado en la barra no pasa de aquí.
 *   4. Es una suscripción de la plataforma (`metadata.kind`), no una recarga de
 *      IA, un pago de paciente ni un diferencial de upgrade.
 *   5. `payment_status === "paid"`: el cobro está acreditado en Stripe.
 *   6. `metadata.firstContract === "1"`: el checkout la estampó como PRIMERA
 *      contratación (isFirstContract: sin suscripción ni periodo activado
 *      jamás). Renovaciones, reactivaciones y cambios de plan llevan "0" o no
 *      llevan la marca, y no disparan. Ver checkout/route.ts.
 *
 * IMPORTE (decisión de Rafael, 25-sep): lo cobrado SIN impuestos y CON el cupón
 * del primer mes ya descontado:
 *     valor = amount_total − total_details.amount_tax   (centavos → pesos)
 * `amount_total` es lo cobrado de verdad (cupón aplicado, IVA sumado si Stripe
 * Tax está encendido) y `amount_tax` es solo el impuesto; la resta deja la base.
 * NO se usa `amount_subtotal`: es ANTES del cupón y sobrecontaría el primer mes.
 * Si `total_details` no viene, el impuesto es 0 (hoy Stripe Tax está apagado
 * salvo STRIPE_AUTOMATIC_TAX=true).
 */

export const PLATFORM_SUBSCRIPTION_KIND = "platform-subscription";

/** Lo mínimo que se lee de una Stripe.Checkout.Session (asignable desde el SDK). */
export interface SesionCheckoutMinima {
  id: string;
  payment_status: string;
  amount_total: number | null;
  /** Desglose del total; `amount_tax` es el impuesto incluido en amount_total. */
  total_details?: { amount_tax?: number | null } | null;
  currency: string | null;
  metadata: Record<string, string> | null;
}

export interface ConversionPagoCompletado {
  transactionId: string;
  valueMxn: number;
  currency: string;
}

const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9]{8,}$/;

/** ¿Tiene forma de id de sesión de Checkout? Corta basura antes de ir a Stripe. */
export function esSessionIdValido(sessionId: string | null | undefined): sessionId is string {
  return typeof sessionId === "string" && SESSION_ID_RE.test(sessionId);
}

/** Centavos de Stripe → pesos con dos decimales (evita 41900/100 = 418.99999). */
export function centavosAPesos(centavos: number | null | undefined): number {
  if (!centavos || !Number.isFinite(centavos) || centavos < 0) return 0;
  return Math.round(centavos) / 100;
}

/**
 * Centavos cobrados SIN impuesto: amount_total − total_details.amount_tax. Sin
 * `total_details` (Stripe Tax apagado) el impuesto cuenta como 0. Nunca negativo.
 */
export function centavosSinImpuesto(sesion: Pick<SesionCheckoutMinima, "amount_total" | "total_details">): number {
  const total = sesion.amount_total ?? 0;
  const impuesto = sesion.total_details?.amount_tax ?? 0;
  if (!Number.isFinite(total) || !Number.isFinite(impuesto)) return 0;
  return Math.max(0, total - impuesto);
}

export function decidirConversionPago(input: {
  /** clinicId de la SESIÓN del usuario (getCurrentUser), nunca del cliente. */
  clinicId: string;
  /** session_id de la URL, ya validado con esSessionIdValido o no. */
  sessionId: string | null | undefined;
  /** La BD dice que la clínica ya no está vencida (webhook aterrizó). */
  activada: boolean;
  /** Sesión traída de Stripe por el servidor, o null si no se pudo. */
  sesion: SesionCheckoutMinima | null;
}): ConversionPagoCompletado | null {
  const { clinicId, sessionId, activada, sesion } = input;
  if (!activada) return null;
  if (!clinicId) return null;
  if (!esSessionIdValido(sessionId)) return null;
  if (!sesion || sesion.id !== sessionId) return null;

  const meta = sesion.metadata ?? {};
  if (meta.clinicId !== clinicId) return null;
  if (meta.kind !== PLATFORM_SUBSCRIPTION_KIND) return null;
  if (sesion.payment_status !== "paid") return null;
  if (meta.firstContract !== "1") return null;

  return {
    transactionId: sesion.id,
    valueMxn: centavosAPesos(centavosSinImpuesto(sesion)),
    currency: (sesion.currency ?? "mxn").toUpperCase(),
  };
}

/**
 * Clave de la marca local del navegador (localStorage) que evita reenviar la
 * misma conversión al recargar. Va por transaction_id: la misma sesión de
 * Stripe, una sola vez en este navegador.
 */
export function claveMarcaLocal(transactionId: string): string {
  return `dc.gads.pago-completado.${transactionId}`;
}
