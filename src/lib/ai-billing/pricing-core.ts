/**
 * Núcleo PURO del precio de la IA: sin Prisma, sin red y sin `server-only`, para
 * que la aritmética del dinero se pruebe sin base de datos
 * (`npm run test:ai-precio-modelo`). `pricing.ts` lo envuelve con la lectura de
 * la base y la cache; los llamadores siguen importando de `./pricing`.
 *
 *   costUsdMicros = tokens × precio DEL MODELO QUE SE USÓ (USD/Mtok)
 *   billedCents   = round(costUsd * usdToMxnRate * (1 + feePct/100) * 100)
 *
 * Hasta el 2026-09-12 había UN precio para todo (el de Sonnet 4.6) y Haiku se
 * cobraba al triple de lo que cuesta. Ahora cada llamada paga lo de su modelo;
 * el tipo de cambio y el fee oculto no cambian.
 */
import type { ModelPrice, PricingConfig } from "./types";

/**
 * Precios de lista de Anthropic, USD por millón de tokens (verificados el
 * 2026-09-12 contra la tabla oficial). Caché con TTL de 5 min, el único que usa
 * la app: escribir = 1.25× la entrada, leer = 0.1× la entrada (Fable 5.1 lee a
 * 0.025×). Si algún día se manda `ttl: "1h"`, la escritura cuesta 2× y esta
 * tabla la subestimaría.
 *
 * ⚠️ Es LA tabla de precios de Anthropic del repo. `realty/studio/pricing.ts`
 * lleva su propia copia (solo entrada/salida) y una prueba falla si se
 * desincronizan. Si Anthropic mueve un precio: se corrige aquí en un renglón,
 * o sin redeploy desde /admin/ai-billing (fila `model:<id>`).
 */
export const ANTHROPIC_MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { inputUsdPerMtok: 1, outputUsdPerMtok: 5, cacheWriteUsdPerMtok: 1.25, cacheReadUsdPerMtok: 0.1 },
  "claude-sonnet-4-6": { inputUsdPerMtok: 3, outputUsdPerMtok: 15, cacheWriteUsdPerMtok: 3.75, cacheReadUsdPerMtok: 0.3 },
  "claude-sonnet-5": { inputUsdPerMtok: 2, outputUsdPerMtok: 10, cacheWriteUsdPerMtok: 2.5, cacheReadUsdPerMtok: 0.2 },
  "claude-opus-5": { inputUsdPerMtok: 5, outputUsdPerMtok: 25, cacheWriteUsdPerMtok: 6.25, cacheReadUsdPerMtok: 0.5 },
  "claude-fable-5": { inputUsdPerMtok: 10, outputUsdPerMtok: 50, cacheWriteUsdPerMtok: 12.5, cacheReadUsdPerMtok: 1 },
  "claude-fable-5-1": { inputUsdPerMtok: 10, outputUsdPerMtok: 50, cacheWriteUsdPerMtok: 12.5, cacheReadUsdPerMtok: 0.25 },
};

/** Los @default del schema para fx y fee; valen si aún no existe la fila. */
const DEFAULT_USD_TO_MXN_RATE = 19.5;
const DEFAULT_FEE_PCT = 8;

/** Fila de AiPricingConfig con el tipo de cambio y el fee (los edita Rafael). */
export const DEFAULT_PRICING_ROW_ID = "default";

/**
 * Precio por modelo editado desde el admin, sin tocar el esquema: otra fila de
 * la MISMA tabla con id `model:<id>`. De esas filas solo se leen los cuatro
 * precios; su usdToMxnRate/feePct quedan con el @default y NO se usan (fx y fee
 * salen siempre de la fila `default`).
 */
export const MODEL_PRICING_ROW_PREFIX = "model:";

const PRICE_KEYS = ["inputUsdPerMtok", "outputUsdPerMtok", "cacheWriteUsdPerMtok", "cacheReadUsdPerMtok"] as const;

/** Lo que devuelve Prisma de `ai_pricing_configs` (solo los campos que importan). */
export type PricingRow = {
  id: string;
  inputUsdPerMtok: number;
  outputUsdPerMtok: number;
  cacheWriteUsdPerMtok: number;
  cacheReadUsdPerMtok: number;
  usdToMxnRate: number;
  feePct: number;
};

/**
 * Id canónico: sin espacios, en minúsculas y sin sufijo de fecha. El chat del
 * asistente manda `claude-haiku-4-5-20251001`; sin esto caería en "desconocido"
 * y se cobraría al precio más caro.
 */
export function normalizeModelId(model: unknown): string {
  if (typeof model !== "string") return "";
  return model.trim().toLowerCase().replace(/[-@]\d{8}$/, "");
}

const isPositive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** El precio más alto de la tabla, campo por campo: nunca sale más barato que ningún modelo. */
function highestPrice(models: Record<string, ModelPrice>): ModelPrice {
  const out: ModelPrice = { inputUsdPerMtok: 0, outputUsdPerMtok: 0, cacheWriteUsdPerMtok: 0, cacheReadUsdPerMtok: 0 };
  for (const price of Object.values(models)) {
    for (const k of PRICE_KEYS) out[k] = Math.max(out[k], price[k]);
  }
  return out;
}

/**
 * Arma el config desde las filas de `ai_pricing_configs`:
 *   · fx y fee, de la fila `default` tal cual (como siempre);
 *   · precio de cada modelo = lista de Anthropic, pisada por su fila `model:<id>`.
 * Una fila de modelo con algún precio en cero, negativo o no numérico se ignora
 * entera: un dedazo no puede dejar un modelo (ni su caché) cobrando cero. Solo
 * valen filas con el id canónico (`model:claude-haiku-4-5`, no con fecha) de un
 * modelo de la tabla: así no hay dos filas peleando por el mismo modelo.
 * Los cuatro precios viejos de la fila `default` ya NO se usan para cobrar.
 */
export function pricingConfigFromRows(rows: readonly PricingRow[]): PricingConfig {
  const def = rows.find((r) => r.id === DEFAULT_PRICING_ROW_ID);
  const models: Record<string, ModelPrice> = {};
  for (const [model, price] of Object.entries(ANTHROPIC_MODEL_PRICES)) models[model] = { ...price };

  for (const r of rows) {
    if (!r.id.startsWith(MODEL_PRICING_ROW_PREFIX)) continue;
    const model = r.id.slice(MODEL_PRICING_ROW_PREFIX.length);
    if (!hasOwn(ANTHROPIC_MODEL_PRICES, model) || normalizeModelId(model) !== model) continue;
    if (!PRICE_KEYS.every((k) => isPositive(r[k]))) continue;
    models[model] = {
      inputUsdPerMtok: r.inputUsdPerMtok,
      outputUsdPerMtok: r.outputUsdPerMtok,
      cacheWriteUsdPerMtok: r.cacheWriteUsdPerMtok,
      cacheReadUsdPerMtok: r.cacheReadUsdPerMtok,
    };
  }

  return {
    models,
    usdToMxnRate: def ? def.usdToMxnRate : DEFAULT_USD_TO_MXN_RATE,
    feePct: def ? def.feePct : DEFAULT_FEE_PCT,
  };
}

// Un aviso por modelo desconocido y proceso: que se vea en los logs sin inundarlos.
const warnedUnknown = new Set<string>();

/**
 * Precio con el que se cobra `model`. Si no está en la tabla (vacío, alias,
 * modelo nuevo puesto por env) se cobra al precio MÁS ALTO conocido: cobrar de
 * menos lo absorbe DaleControl sin que nadie lo note; cobrar de más se ve y se
 * corrige añadiendo el modelo a la tabla.
 */
export function resolveModelPrice(model: unknown, cfg: PricingConfig): { price: ModelPrice; known: boolean } {
  const id = normalizeModelId(model);
  if (cfg.models && hasOwn(cfg.models, id)) return { price: cfg.models[id], known: true };

  const fallback = highestPrice(cfg.models ?? {});
  const price = isPositive(fallback.inputUsdPerMtok) ? fallback : highestPrice(ANTHROPIC_MODEL_PRICES);
  const key = String(model);
  if (!warnedUnknown.has(key)) {
    warnedUnknown.add(key);
    console.warn("[ai-billing] modelo sin precio en la tabla; se cobra al precio más alto conocido", { model });
  }
  return { price, known: false };
}

/**
 * Costo real de Anthropic en MICRO-USD (entero) para una llamada, al precio del
 * modelo que se usó.
 * usdPerMtok = USD por millón de tokens ⇒ tokens * usdPerMtok = micro-USD
 * (porque tokens/1e6 * usdPerMtok = USD, y USD * 1e6 = micro-USD).
 *
 * `cacheTokens` se cobra al precio de LECTURA (cache_read); el bot no usa cache
 * hoy, así que en la práctica suele ser 0. `cacheWriteTokens` es opcional y
 * pertenece a las rutas clínicas, que sí mandan `cache_control: ephemeral`:
 * escribir cache cuesta 12.5x leerlo, así que meterlo en el mismo saco
 * subestimaría el costo real ~25% en un análisis con cache frío.
 * Los llamadores viejos (chargeUsage) no lo pasan y se comportan igual que antes.
 */
export function computeCostUsdMicros(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheTokens: number,
  cfg: PricingConfig,
  cacheWriteTokens = 0,
): number {
  const { price } = resolveModelPrice(model, cfg);
  const micros =
    inputTokens * price.inputUsdPerMtok +
    outputTokens * price.outputUsdPerMtok +
    cacheTokens * price.cacheReadUsdPerMtok +
    cacheWriteTokens * price.cacheWriteUsdPerMtok;
  return Math.max(0, Math.round(micros));
}

/** Convierte costo (micro-USD) a centavos MXN cobrados, fee OCULTO incluido. */
export function usdMicrosToBilledCents(costUsdMicros: number, cfg: PricingConfig): number {
  const costUsd = costUsdMicros / 1_000_000;
  const mxn = costUsd * cfg.usdToMxnRate * (1 + cfg.feePct / 100);
  return Math.max(0, Math.round(mxn * 100));
}

/** Una fila del editor de precios por modelo de /admin/ai-billing. */
export type ModelPriceRow = ModelPrice & {
  model: string;
  /** Precio de lista de Anthropic, para ver si lo editado se separó de él. */
  list: ModelPrice;
  /** true = difiere del precio de lista (lo pisa una fila `model:<id>`). */
  edited: boolean;
};

/** Los modelos de la tabla con su precio vigente, en el orden de la tabla. */
export function modelPriceRows(cfg: PricingConfig): ModelPriceRow[] {
  return Object.entries(ANTHROPIC_MODEL_PRICES).map(([model, list]) => {
    const price = cfg.models?.[model] ?? list;
    return {
      model,
      ...price,
      list: { ...list },
      edited: PRICE_KEYS.some((k) => price[k] !== list[k]),
    };
  });
}

/**
 * Valida los precios por modelo que manda el admin (PATCH). Solo modelos de la
 * tabla; los cuatro campos obligatorios y > 0 (ningún precio real es cero: un
 * campo vacío que llega como 0 regalaría esos tokens).
 */
export function parseModelPriceEdits(
  raw: unknown,
):
  | { ok: true; edits: Array<{ model: string; price: ModelPrice }>; error?: undefined }
  | { ok: false; edits?: undefined; error: string } {
  // (`error`/`edits` opcionales en ambas ramas: con strict:false TS no estrecha por `ok`.)
  if (raw === undefined || raw === null) return { ok: true, edits: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "models debe ser un objeto { modelo: precios }" };

  const edits: Array<{ model: string; price: ModelPrice }> = [];
  for (const [rawModel, value] of Object.entries(raw as Record<string, unknown>)) {
    const model = normalizeModelId(rawModel);
    if (!hasOwn(ANTHROPIC_MODEL_PRICES, model)) {
      return { ok: false, error: `Modelo sin precio de lista: ${rawModel}` };
    }
    if (!value || typeof value !== "object") return { ok: false, error: `Precios inválidos para ${model}` };
    const v = value as Record<string, unknown>;
    const price = {} as ModelPrice;
    for (const k of PRICE_KEYS) {
      const n = v[k] === "" || v[k] === null || v[k] === undefined ? Number.NaN : Number(v[k]);
      if (!isPositive(n)) return { ok: false, error: `Valor inválido para ${model} · ${k}` };
      price[k] = n;
    }
    edits.push({ model, price });
  }
  return { ok: true, edits };
}

/** ¿Son iguales dos precios? */
export function samePrice(a: ModelPrice, b: ModelPrice): boolean {
  return PRICE_KEYS.every((k) => a[k] === b[k]);
}

/**
 * Qué ediciones del admin se escriben: las que difieren del precio de lista, o
 * las de un modelo que YA tiene fila (para poder devolverlo a la lista). No se
 * crean filas que solo repiten la lista: así, si la tabla en código cambia, el
 * cambio sigue aplicando a los modelos que nadie editó.
 */
export function modelEditsToWrite(
  edits: ReadonlyArray<{ model: string; price: ModelPrice }>,
  existingRowIds: ReadonlySet<string>,
): Array<{ model: string; price: ModelPrice }> {
  return edits.filter(
    (e) => existingRowIds.has(MODEL_PRICING_ROW_PREFIX + e.model) || !samePrice(e.price, ANTHROPIC_MODEL_PRICES[e.model]),
  );
}
