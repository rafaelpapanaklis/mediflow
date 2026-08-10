import { prisma } from "@/lib/prisma";
import {
  AI_FEATURE_CHAT_ASSISTANT,
  AI_FEATURE_CONSULT_ANALYSIS,
  AI_FEATURE_PRESCRIPTION_CHECK,
  AI_FEATURE_XRAY_ANALYSIS,
} from "@/lib/ai-billing/types";

/**
 * Slugs estables (en inglés) de cada función de IA que cobra contra el cupo
 * mensual del plan. Lista CERRADA: si un caller manda algo fuera de aquí se
 * normaliza a "other" para que el desglose no se contamine.
 *
 * ⚠️ No confundir con AiUsageEvent.feature, que es la contabilidad en DINERO
 * (costo real en USD). Ahí conviven el prepago del bot de WhatsApp y el costo
 * que DaleControl absorbe por la IA clínica; los slugs son otros y se traducen
 * a estos con AI_FEATURE_ALIASES, más abajo.
 */
export const AI_FEATURES = [
  "chat",               // POST /api/ai — asistente de chat del panel
  "xray_analysis",      // POST /api/xrays/[id]/analyze — visión sobre radiografías
  "dictation",          // POST /api/ai/transcribe — dictado por voz (Whisper)
  "consult_assist",     // POST /api/consult/ai-assist — asistente de consulta
  "contraindications",  // POST /api/prescriptions/check-contraindications
  "homeopathy",         // POST /api/homeopatia/suggest-remedies
  "ai_insight",         // POST /api/analytics/ai-insight
  "no_show_prediction", // POST /api/analytics/no-shows/predict
  "clinic_layout",      // POST /api/clinic-layout/optimize
  "other",              // fallback — llamadas sin feature declarada
] as const;

export type AiFeature = (typeof AI_FEATURES)[number];

/** Slug → clave i18n de la etiqueta visible (existe en es.json y en.json). */
export const AI_FEATURE_LABEL_KEY: Record<AiFeature, string> = {
  chat:               "common.aiFeature.chat",
  xray_analysis:      "common.aiFeature.xrayAnalysis",
  dictation:          "common.aiFeature.dictation",
  consult_assist:     "common.aiFeature.consultAssist",
  contraindications:  "common.aiFeature.contraindications",
  homeopathy:         "common.aiFeature.homeopathy",
  ai_insight:         "common.aiFeature.aiInsight",
  no_show_prediction: "common.aiFeature.noShowPrediction",
  clinic_layout:      "common.aiFeature.clinicLayout",
  other:              "common.aiFeature.other",
};

/**
 * Alias: slug de `AiUsageEvent.feature` (contabilidad de la Tesorería) → slug
 * del cupo del plan. Las dos contabilidades le pusieron nombres distintos a la
 * MISMA función; aquí convergen para que el desglose que ve la clínica salga
 * igual venga de la tabla del cupo o de los eventos de costo.
 */
const AI_FEATURE_ALIASES: Record<string, AiFeature> = {
  [AI_FEATURE_CHAT_ASSISTANT]: "chat",
  [AI_FEATURE_CONSULT_ANALYSIS]: "consult_assist",
  [AI_FEATURE_XRAY_ANALYSIS]: "xray_analysis", // mismo slug en las dos; explícito a propósito
  [AI_FEATURE_PRESCRIPTION_CHECK]: "contraindications",
};

/**
 * Normaliza a la lista cerrada; cualquier cosa desconocida cae en "other".
 * hasOwnProperty y no `AI_FEATURE_ALIASES[feature]` a secas: un slug heredado
 * de Object ("constructor") devolvería una función en vez de un AiFeature.
 */
export function normalizeAiFeature(feature: string | null | undefined): AiFeature {
  if (AI_FEATURES.includes(feature as AiFeature)) return feature as AiFeature;
  if (feature && Object.prototype.hasOwnProperty.call(AI_FEATURE_ALIASES, feature)) {
    return AI_FEATURE_ALIASES[feature];
  }
  return "other";
}

/**
 * Inicio del MES EN CURSO con la MISMA semántica que el reseteo mensual del
 * cupo: mes de calendario, getters locales (la zona del proceso Node), no UTC
 * ni ventana móvil de 30 días. Cualquier filtro "de este mes" sobre el
 * desglose DEBE usar esto para no mezclar meses.
 *
 * Ojo: NO uses aiLastResetAt como corte — ese timestamp no es el día 1, es el
 * momento de la primera llamada de IA del mes nuevo (reseteo perezoso).
 */
export function aiMonthStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * Si la clínica agotó su cupo mensual de tokens IA, devuelve el objeto de error
 * (úsalo con status 429); si hay cupo, null. Resetea el contador si cambió el mes.
 * Mismo patrón que /api/ai. Plan Básico (límite 0) → siempre bloquea.
 */
export async function aiTokenLimitError(
  clinicId: string,
): Promise<{ error: string; limitReached: true; used: number; limit: number } | null> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { aiTokensUsed: true, aiTokensLimit: true, aiLastResetAt: true },
  });
  if (!clinic) return null;
  const lastReset = new Date(clinic.aiLastResetAt);
  const now = new Date();
  const monthsDiff =
    (now.getFullYear() - lastReset.getFullYear()) * 12 + (now.getMonth() - lastReset.getMonth());
  let used = clinic.aiTokensUsed;
  if (monthsDiff >= 1) {
    await prisma.clinic.update({ where: { id: clinicId }, data: { aiTokensUsed: 0, aiLastResetAt: now } });
    used = 0;
  }
  if (used >= clinic.aiTokensLimit) {
    return {
      error: "Tu plan no incluye esta función de IA o agotaste el cupo mensual. Sube de plan.",
      limitReached: true,
      used,
      limit: clinic.aiTokensLimit,
    };
  }
  return null;
}

/**
 * Suma tokens consumidos al contador de la clínica Y registra la fila de
 * desglose por feature. Punto ÚNICO de cobro del cupo del plan: el contador y
 * el desglose se mueven siempre juntos, así que sumar el desglose de un mes da
 * ~= aiTokensUsed de ese mes.
 *
 * FAIL-OPEN en todo: la IA del cliente ya respondió cuando llegamos aquí, así
 * que un fallo de metering se loguea pero JAMÁS revienta la operación. Si el
 * incremento falla no se escribe desglose (descuadraría las dos cifras).
 *
 * Firma retrocompatible: `feature` es opcional (default "other") y `userId`
 * también. Ambos se pasan desde cada ruta. El tipo es el union CERRADO a
 * propósito: así un slug con typo ("xray-analysis") no compila en vez de
 * colarse silenciosamente al bucket "other".
 */
export async function addAiTokens(
  clinicId: string,
  tokens: number,
  feature: AiFeature = "other",
  userId?: string | null,
): Promise<void> {
  if (!tokens || tokens <= 0) return;

  try {
    await prisma.clinic.update({
      where: { id: clinicId },
      data: { aiTokensUsed: { increment: tokens } },
    });
  } catch (err) {
    console.error("[ai-tokens] no se pudo incrementar aiTokensUsed (fail-open)", {
      clinicId,
      feature,
      tokens,
      err,
    });
    return;
  }

  // Desglose: requiere sql/ai-quota-usage.sql aplicado. Si la tabla no existe
  // (deploy parcial) o el insert falla, solo se pierde el detalle — el cupo ya
  // quedó cobrado y la respuesta de IA sigue su camino.
  try {
    await prisma.aiQuotaUsage.create({
      data: {
        clinicId,
        feature: normalizeAiFeature(feature),
        tokens,
        userId: userId ?? null,
      },
    });
  } catch (err) {
    console.error("[ai-tokens] desglose de IA no registrado (fail-open)", {
      clinicId,
      feature,
      tokens,
      err,
    });
  }
}
