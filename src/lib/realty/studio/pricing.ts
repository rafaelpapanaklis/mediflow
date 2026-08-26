// ═══════════════════════════════════════════════════════════════════════
// ESTUDIO IA — precios y TOPE DE GASTO. Núcleo PURO.
//
// Sin Prisma, sin red, sin `server-only`: todo lo de aquí se prueba sin base
// de datos. Es el archivo que decide cuánto costó una generación y si la
// cuenta todavía tiene permitido gastar hoy.
//
// 🔴 POR QUÉ EXISTE EL TOPE. Sin un tope por cuenta y por día, UNA sola
// inmobiliaria puede vaciar el presupuesto de IA de TODAS en una tarde: le
// basta con dejar el botón de "generar" apretado. El bot de barber ya
// aprendió esto (spentMicros/capMicros) y aquí se repite el patrón.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Todo el dinero de este módulo se cuenta en MICRODÓLARES (millonésimas de
 * dólar), en enteros. Nunca en floats: sumar 0.0225 ochenta veces da
 * 1.7999999999999998, y un tope comparado contra eso falla justo en el
 * borde. Mismo criterio que el dinero en centavos del resto del vertical.
 */
export type Micros = number;

export const USD_TO_MICROS = 1_000_000;

export function usdToMicros(usd: number): Micros {
  return Math.round(usd * USD_TO_MICROS);
}

export function microsToUsd(micros: Micros): number {
  return micros / USD_TO_MICROS;
}

/** "$0.023 USD" — para enseñar el costo de UNA generación. */
export function formatMicrosUsd(micros: Micros): string {
  const usd = microsToUsd(Math.max(0, micros));
  // Menos de diez centavos se enseña con tres decimales: con dos, todas las
  // generaciones de texto dirían "$0.02" y parecerían iguales.
  return usd < 0.1 ? `$${usd.toFixed(3)} USD` : `$${usd.toFixed(2)} USD`;
}

// ── Precios de los modelos ──────────────────────────────────────────────

/**
 * Precio por MILLÓN de tokens, en dólares (tabla pública de Anthropic:
 * Claude Opus 5 cuesta $5 de entrada y $25 de salida).
 *
 * ⚠️ ESTO CADUCA. Si Anthropic mueve sus precios, este número miente y el
 * tope deja de proteger lo que cree proteger. Es una constante a la vista
 * justamente para que se corrija en un renglón.
 */
export const MODEL_PRICE_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Modelo por defecto del estudio. Se puede pisar con REALTY_AI_MODEL. */
export const REALTY_STUDIO_DEFAULT_MODEL = "claude-opus-5";

/**
 * Costo de una llamada de TEXTO, en micros.
 *
 * $5 por millón de tokens = 5 micros por token, así que la cuenta es
 * `entrada × 5 + salida × 25` para Opus 5. Se redondea HACIA ARRIBA: cobrar
 * de menos por redondeo es la forma lenta de quedarse sin tope.
 */
export function textCallMicros(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Micros {
  const price = MODEL_PRICE_USD_PER_MTOK[args.model] ?? MODEL_PRICE_USD_PER_MTOK["claude-opus-5"];
  const inTok = Math.max(0, Math.round(args.inputTokens || 0));
  const outTok = Math.max(0, Math.round(args.outputTokens || 0));
  return Math.ceil(inTok * price.input + outTok * price.output);
}

/**
 * Costo de UNA imagen de staging, en micros.
 *
 * 🔴 ES UNA ESTIMACIÓN, no una factura. La API de imágenes cobra por imagen
 * según tamaño y calidad, y el precio NO viene en la respuesta — así que, a
 * diferencia del texto (donde `usage` trae los tokens reales), aquí no hay
 * forma de saber lo que costó de verdad sin mirar el tablero del proveedor.
 * Se le carga al tope el valor de lista, que es el lado seguro: si el precio
 * real es menor, el tope protege de más.
 */
export const STAGING_IMAGE_MICROS: Micros = usdToMicros(0.19);

// ── El tope diario ──────────────────────────────────────────────────────

/**
 * Tope por cuenta y por DÍA NATURAL, en micros. Por defecto 2 USD.
 *
 * Con Opus 5, 2 USD son ~88 descripciones o ~10 imágenes de staging al día
 * para UNA inmobiliaria: de sobra para trabajar, y un techo que no puede
 * arruinar el mes si alguien se emociona con el botón.
 *
 * Se lee del entorno para poder subirlo sin desplegar. Un valor inválido NO
 * apaga el tope: cae al default. Un tope que se desactiva solo por un dedazo
 * en una variable de entorno no es un tope.
 */
export const REALTY_STUDIO_DEFAULT_DAILY_CAP_USD = 2;

export function dailyCapMicros(
  env: string | undefined = process.env.REALTY_STUDIO_DAILY_CAP_USD,
): Micros {
  const raw = Number(env);
  if (!Number.isFinite(raw) || raw <= 0) {
    return usdToMicros(REALTY_STUDIO_DEFAULT_DAILY_CAP_USD);
  }
  return usdToMicros(raw);
}

export interface StudioSpendDTO {
  /** Gastado HOY, en micros. */
  spentMicros: Micros;
  capMicros: Micros;
  /** Lo que queda hoy. Nunca negativo. */
  remainingMicros: Micros;
  /** true = ya no se puede generar hasta mañana. */
  exhausted: boolean;
  /** true = queda menos del 20 %. La pantalla avisa ANTES de que truene. */
  nearLimit: boolean;
  /** Cuándo se reinicia, en ISO: la medianoche de la CUENTA. */
  resetsAt: string;
  /** Gastado en el MES, solo informativo. */
  monthMicros: Micros;
}

export function buildStudioSpend(args: {
  spentMicros: Micros;
  capMicros: Micros;
  monthMicros: Micros;
  resetsAt: Date;
}): StudioSpendDTO {
  const spent = Math.max(0, args.spentMicros);
  const cap = Math.max(0, args.capMicros);
  const remaining = Math.max(0, cap - spent);
  return {
    spentMicros: spent,
    capMicros: cap,
    remainingMicros: remaining,
    exhausted: spent >= cap,
    nearLimit: spent < cap && cap > 0 && remaining <= cap * 0.2,
    resetsAt: args.resetsAt.toISOString(),
    monthMicros: Math.max(0, args.monthMicros),
  };
}

/**
 * ¿Cabe una generación más?
 *
 * 🔴 Se compara el gasto YA HECHO contra el tope, y NO se exige que el costo
 * completo quepa. Es deliberado: el costo de una llamada de texto no se
 * conoce hasta DESPUÉS de hacerla (depende de los tokens que devuelva el
 * modelo). Exigir que quepa un estimado obligaría a inventar un número y a
 * rechazar generaciones que sí cabían. Lo que se garantiza es que una cuenta
 * nunca EMPIEZA una generación estando ya en el tope; el desbordamiento
 * máximo posible es el costo de una sola llamada.
 */
export function studioFits(spentMicros: Micros, capMicros: Micros): boolean {
  if (capMicros <= 0) return false;
  return spentMicros < capMicros;
}
