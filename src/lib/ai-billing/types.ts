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

/** feature por defecto: el único consumo facturable hoy es el bot de WhatsApp. */
export const AI_FEATURE_WHATSAPP_BOT = "whatsapp_bot";

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
