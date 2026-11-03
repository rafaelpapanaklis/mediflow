import { prisma } from "@/lib/prisma";
import { tokensDeLasOtrasSedes } from "@/lib/ai-tokens-owner";
import {
  AI_FEATURE_CHAT_ASSISTANT,
  AI_FEATURE_CONSULT_ANALYSIS,
  AI_FEATURE_PRESCRIPTION_CHECK,
  AI_FEATURE_XRAY_ANALYSIS,
} from "@/lib/ai-billing/types";
import { tokensPorTexto } from "@/lib/ai-billing/reserva-core";

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
export type ErrorCupoIa = { error: string; limitReached: true; used: number; limit: number };

const MENSAJE_SIN_CUPO = "Tu plan no incluye esta función de IA o agotaste el cupo mensual. Sube de plan.";

function errorSinCupo(used: number, limit: number): ErrorCupoIa {
  return { error: MENSAJE_SIN_CUPO, limitReached: true, used, limit };
}

/**
 * Lee el contador de la clínica y lo resetea si cambió el mes (reseteo
 * perezoso). null si la clínica no existe. `resetAt` = el aiLastResetAt
 * vigente (el del mes al que pertenece `used`).
 *
 * Revisión t5 (m1): el reseteo va CONDICIONADO al aiLastResetAt leído. Antes
 * era un update a secas: dos peticiones el día 1 leían el mes viejo, la segunda
 * volvía a poner 0 y BORRABA la reserva que la primera acababa de apartar. Si
 * otra ya reseteó (count 0), se relee su contador.
 */
async function contadorDelMes(clinicId: string): Promise<{ used: number; limit: number; resetAt: Date } | null> {
  for (let intento = 0; intento < 3; intento++) {
    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { aiTokensUsed: true, aiTokensLimit: true, aiLastResetAt: true },
    });
    if (!clinic) return null;
    const lastReset = new Date(clinic.aiLastResetAt);
    const now = new Date();
    const monthsDiff =
      (now.getFullYear() - lastReset.getFullYear()) * 12 + (now.getMonth() - lastReset.getMonth());
    if (monthsDiff < 1) return { used: clinic.aiTokensUsed, limit: clinic.aiTokensLimit, resetAt: clinic.aiLastResetAt };
    const r = await prisma.clinic.updateMany({
      where: { id: clinicId, aiLastResetAt: clinic.aiLastResetAt },
      data: { aiTokensUsed: 0, aiLastResetAt: now },
    });
    if (r.count === 1) return { used: 0, limit: clinic.aiTokensLimit, resetAt: now };
    // Otra petición reseteó entre la lectura y la escritura: se relee.
  }
  const c = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { aiTokensUsed: true, aiTokensLimit: true, aiLastResetAt: true },
  });
  return c ? { used: c.aiTokensUsed, limit: c.aiTokensLimit, resetAt: c.aiLastResetAt } : null;
}

export async function aiTokenLimitError(
  clinicId: string,
): Promise<ErrorCupoIa | null> {
  const c = await contadorDelMes(clinicId);
  if (!c) return null;
  const used = c.used + (await tokensDeLasOtrasSedes(clinicId)).tokens; // cupo POR DUEÑO: suman todas sus sedes
  if (used >= c.limit) return errorSinCupo(used, c.limit);
  return null;
}

// ── Reserva del cupo (seguridad ola 2b, lead 18) ─────────────────────────────
// `aiTokenLimitError` solo LEE y `addAiTokens` cobra DESPUÉS de la respuesta:
// todas las peticiones que leían antes de que la primera cobrara entraban, y
// una sola llamada enorme a 1 token del tope pasaba entera. Como
// `reservarSaldo` del monedero: antes de llamar se APARTA el techo de la
// llamada con un UPDATE condicionado (atómico en Postgres), al volver se ajusta
// a lo real y, si la llamada falla, se suelta.
//
// Límite conocido: el contador es por clínica y el cupo por dueño. Lo de las
// otras sedes se lee antes del UPDATE; dos sedes del mismo dueño a la vez
// pueden pasarse a lo sumo por el techo de una llamada cada una.
// Si el proceso muere entre reservar y liquidar, el techo se queda contado ese
// mes (no hay caducidad como en el monedero): pierde cupo la clínica, nunca
// gana DaleControl gasto sin contar.

export interface ReservaCupoIa {
  clinicId: string;
  tokens: number;
  /**
   * Revisión t5 (m2): el aiLastResetAt del mes en que se apartó. Si al liquidar
   * el contador ya se reseteó (cambio de mes), lo que sobró NO se descuenta del
   * mes nuevo (la reserva se borró con el reseteo); lo que faltó sí se suma.
   */
  resetAt: Date | null;
}

/** Techo de tokens de una llamada a Claude: la entrada a 2 caracteres por token, más toda la salida permitida. */
export function techoDeTokens(textos: ReadonlyArray<string>, maxTokens: number): number {
  const caracteres = textos.reduce((s, t) => s + (t?.length ?? 0), 0);
  return tokensPorTexto(caracteres) + Math.max(0, Math.ceil(maxTokens || 0));
}

/**
 * Aparta `tokens` del cupo del plan ANTES de llamar al proveedor. Pasa solo si
 * el techo CABE en lo que queda (lo de la clínica + sus otras sedes + el techo
 * ≤ límite). Forma plana: `reserva` o `error` (para el 429), nunca los dos.
 * Clínica inexistente: reserva vacía (mismo criterio que aiTokenLimitError).
 */
export async function reservarCupoIa(
  clinicId: string,
  tokens: number,
): Promise<{ reserva: ReservaCupoIa | null; error: ErrorCupoIa | null }> {
  const techo = Math.max(0, Math.ceil(tokens || 0));
  const c = await contadorDelMes(clinicId);
  if (!c) return { reserva: { clinicId, tokens: 0, resetAt: null }, error: null };
  const otras = (await tokensDeLasOtrasSedes(clinicId)).tokens;
  const tope = c.limit - otras - techo;
  if (c.used + otras >= c.limit || c.used > tope) {
    return { reserva: null, error: errorSinCupo(c.used + otras, c.limit) };
  }
  const r = await prisma.clinic.updateMany({
    where: { id: clinicId, aiTokensUsed: { lte: tope } },
    data: { aiTokensUsed: { increment: techo } },
  });
  if (r.count === 0) {
    // Otra petición apartó antes: lo que queda ya no alcanza.
    const ahora = await contadorDelMes(clinicId);
    return { reserva: null, error: errorSinCupo((ahora?.used ?? c.used) + otras, c.limit) };
  }
  return { reserva: { clinicId, tokens: techo, resetAt: c.resetAt }, error: null };
}

/**
 * Cierra la reserva con lo que de verdad se gastó: ajusta el contador por la
 * diferencia y escribe el desglose con lo real. `tokensReales` 0 = la llamada
 * no costó (error, mock): solo suelta lo apartado. FAIL-OPEN como addAiTokens.
 */
export async function liquidarCupoIa(
  reserva: ReservaCupoIa,
  tokensReales: number,
  feature: AiFeature = "other",
  userId?: string | null,
): Promise<void> {
  const real = Math.max(0, Math.round(tokensReales || 0));
  const delta = real - reserva.tokens;
  try {
    if (delta > 0) {
      await prisma.clinic.update({ where: { id: reserva.clinicId }, data: { aiTokensUsed: { increment: delta } } });
    } else if (delta < 0) {
      // Solo si el contador sigue en el mes de la reserva (m2 de t5) y con suelo.
      await prisma.clinic.updateMany({
        where: {
          id: reserva.clinicId,
          aiTokensUsed: { gte: -delta },
          ...(reserva.resetAt ? { aiLastResetAt: reserva.resetAt } : {}),
        },
        data: { aiTokensUsed: { decrement: -delta } },
      });
    }
  } catch (err) {
    console.error("[ai-tokens] no se pudo liquidar la reserva del cupo (fail-open)", { clinicId: reserva.clinicId, feature, real, err });
    return;
  }
  if (real > 0) await registrarDesglose(reserva.clinicId, real, feature, userId);
}

/** Suelta una reserva sin cobrar nada (la llamada falló o no ocurrió). */
export async function soltarCupoIa(reserva: ReservaCupoIa | null): Promise<void> {
  if (reserva && reserva.tokens > 0) await liquidarCupoIa(reserva, 0);
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

  await registrarDesglose(clinicId, tokens, feature, userId);
}

async function registrarDesglose(
  clinicId: string,
  tokens: number,
  feature: AiFeature,
  userId?: string | null,
): Promise<void> {
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
