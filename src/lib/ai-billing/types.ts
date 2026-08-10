/**
 * Tipos del sistema de cobro de tokens de IA (fundación T1).
 *
 * Contrato que leen T2 (UI), T3 (Stripe), T4 (MercadoPago), T5 (SPEI),
 * T6 (admin/tesorería) y T7. Dinero SIEMPRE en centavos enteros (Int) y, de
 * cara a la clínica, en MXN. El costo real de Anthropic se guarda en micro-USD.
 * La clínica NUNCA ve USD ni el fee: `billedCents` ya incluye fx + fee oculto.
 *
 * Sin `server-only`: son solo tipos/constantes, así T2 (UI client) puede
 * importarlos para tipar sin romper el build.
 */

/** feature por defecto: el único consumo PREPAGO (facturable) es el bot de WhatsApp. */
export const AI_FEATURE_WHATSAPP_BOT = "whatsapp_bot";

/**
 * Features de IA CLÍNICA. Se registran como COSTO real de Anthropic con
 * `billedCents = 0`: la clínica NO paga extra por ellas porque su plan ya las
 * incluye. Existen para que la Tesorería sepa cuánto absorbe DaleControl del
 * cheque a Anthropic; nunca tocan el monedero prepago.
 *
 * `billedCents = 0` es LA marca de "incluido en el plan": la Tesorería separa
 * los dos bloques con ella (> 0 = prepago, = 0 = absorbido).
 */
export const AI_FEATURE_CHAT_ASSISTANT = "chat_assistant";
export const AI_FEATURE_CONSULT_ANALYSIS = "consult_analysis";
export const AI_FEATURE_XRAY_ANALYSIS = "xray_analysis";
export const AI_FEATURE_PRESCRIPTION_CHECK = "prescription_check";

/** Las 4 features que el plan absorbe (nunca se cobran al monedero). */
export const AI_INCLUDED_FEATURES = [
  AI_FEATURE_CHAT_ASSISTANT,
  AI_FEATURE_CONSULT_ANALYSIS,
  AI_FEATURE_XRAY_ANALYSIS,
  AI_FEATURE_PRESCRIPTION_CHECK,
] as const;

/**
 * Etiquetas legibles de `AiUsageEvent.feature`. En español fijo a propósito:
 * las pantallas que las usan (Tesorería y saldo del bot) son de DaleControl o
 * del panel en español, no pasan por i18n. El desglose del CUPO del plan sí
 * está traducido — ver AI_FEATURE_LABEL_KEY en `@/lib/ai-tokens`.
 */
export const AI_BILLING_FEATURE_LABEL_ES: Record<string, string> = {
  [AI_FEATURE_WHATSAPP_BOT]: "Bot de WhatsApp",
  [AI_FEATURE_CHAT_ASSISTANT]: "Chat del asistente",
  [AI_FEATURE_CONSULT_ANALYSIS]: "Análisis de consulta",
  [AI_FEATURE_XRAY_ANALYSIS]: "Análisis de radiografías",
  [AI_FEATURE_PRESCRIPTION_CHECK]: "Revisión de recetas",
};

/**
 * Etiqueta legible de un feature; si no la conoce devuelve el slug crudo.
 * hasOwnProperty y no `map[feature]` a secas: un feature con nombre heredado
 * de Object ("constructor") devolvería una función en vez de texto.
 */
export function aiBillingFeatureLabel(feature: string): string {
  if (feature && Object.prototype.hasOwnProperty.call(AI_BILLING_FEATURE_LABEL_ES, feature)) {
    return AI_BILLING_FEATURE_LABEL_ES[feature];
  }
  return feature;
}

/** Sobregiro de gracia (centavos MXN) permitido SOLO con auto-recarga + tarjeta. */
export const GRACE_OVERDRAFT_CENTS = 10_000;

/** Precios efectivos (lo que devuelve getPricingConfig). Espeja AiPricingConfig. */
export interface PricingConfig {
  inputUsdPerMtok: number;
  outputUsdPerMtok: number;
  cacheWriteUsdPerMtok: number;
  cacheReadUsdPerMtok: number;
  usdToMxnRate: number;
  feePct: number;
}

/** Input de chargeUsage: una llamada facturable a Claude que YA se ejecutó. */
export interface ChargeUsageInput {
  clinicId: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  threadId?: string;
}

/**
 * Input de recordUsageNoCharge: una llamada a Claude que YA se ejecutó y que el
 * plan de la clínica absorbe. Mismos campos que ChargeUsageInput salvo threadId
 * (no hay hilo) y con el cache partido en dos: la ESCRITURA de cache cuesta
 * ~12x la lectura, así que juntarlas subestimaría el costo real.
 */
export interface RecordUsageNoChargeInput {
  clinicId: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** cache_read_input_tokens */
  cacheTokens?: number;
  /** cache_creation_input_tokens */
  cacheWriteTokens?: number;
}

/** Resultado de un cobro de consumo. */
export interface ChargeUsageResult {
  billedCents: number;
  balanceAfterCents: number;
  eventId: string;
}

/** Resultado del stub de cobro off-session (lo rellena T3 con Stripe). */
export interface RechargeResult {
  ok: boolean;
  error?: string;
}
