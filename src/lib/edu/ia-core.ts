/**
 * DaleControl INSTITUCIONAL — LA IA DEL VERTICAL, Y QUIÉN LA PAGA.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin process.env
 * en el camino de la pantalla): decide en UN solo sitio si el dictado y el
 * análisis radiográfico están disponibles, y —cuando no lo están— POR QUÉ.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 DE DÓNDE VIENE ESTE ARCHIVO, PORQUE ES LA MITAD DE LA EXPLICACIÓN
 *
 * Las dos funciones de IA cuestan dinero de verdad (Whisper de OpenAI por
 * minuto de audio; Claude con visión por imagen analizada). La Ola 3B las
 * dejó APAGADAS tras una bandera de entorno porque el instituto no tenía a
 * qué cargarle el gasto: el dental descuenta contra Clinic.aiTokensLimit y
 * un usuario de instituto no tiene fila de clínica.
 *
 * Esta ola le da su forma de pagar, y NO es la del dental:
 *
 *   · el dental cobra a una CARTERA que se recarga con una tarjeta;
 *   · el instituto paga por CONTRATO ANUAL (no pasa por Stripe: mira
 *     EduInstitution.contractStartsAt / contractEndsAt), así que su IA es
 *     un CUPO MENSUAL INCLUIDO en ese contrato, más lo que la escuela
 *     decida permitir de más.
 *
 * De ahí salen las tres tablas (EduAiQuota, EduAiUsage, EduAiPrice) y de
 * ahí sale este archivo, que es el único que decide si el micrófono se
 * puede tocar.
 *
 * 🔴 EL INTERRUPTOR YA NO ES UNA VARIABLE DE ENTORNO. `EDU_IA_ENABLED`
 * dejó de ser la puerta: ahora nace ENCENDIDA y solo sirve como freno de
 * emergencia global de DaleControl (ponerla en "0" apaga la IA en TODAS
 * las escuelas de golpe, para una incidencia). Lo que enciende la IA de un
 * instituto es tener CUPO configurado — una fila de EduAiQuota— y eso se
 * decide por escuela, que es como tenía que ser desde el principio: una
 * bandera global no sabe distinguir a la escuela que contrató IA de la que
 * no.
 *
 * 🔴 NINGÚN PRECIO VIVE EN ESTE ARCHIVO. Antes había una tabla de tarifas
 * escrita a mano aquí (`EDU_IA_PRECIO_USD_POR_MTOK`) y se fue: los precios
 * viven en `edu_ai_prices` y llegan aquí como DATO (`EduIaPrecio`). Una
 * constante de precio en el código es un número que alguien tiene que
 * acordarse de cambiar cuando el proveedor lo cambie, y el día que no se
 * acuerde el cupo de la escuela empieza a mentir sin que nadie lo note.
 *
 * ⚠️ LO QUE NO CAMBIÓ, Y NO PUEDE CAMBIAR: el análisis sigue siendo APOYO
 * y no diagnóstico, y NUNCA se escribe solo dentro de una nota firmada.
 * Eso lo sostienen `EDU_ANALISIS_AVISO` y `eduAnalisisComoTexto` más abajo,
 * y las pruebas que los fijan.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { eduUtcToZoned, eduSafeTimeZone } from "@/lib/edu/agenda-core";
import { parseEduMoneyCents } from "@/lib/edu/dinero-core";
import {
  EDU_AI_FEATURES,
  EDU_AI_FEATURE_LABELS,
  type EduAiFeature,
  type EduAiUnit,
  type EduRole,
} from "@/lib/edu/types";

export { EDU_AI_FEATURES, EDU_AI_FEATURE_LABELS };
export type { EduAiFeature, EduAiUnit };

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL DINERO: DOS UNIDADES, Y CADA UNA TIENE SU RAZÓN
//
//   · el PRESUPUESTO va en CENTAVOS de dólar (lo que teclea una persona);
//   · el MEDIDOR va en MILLONÉSIMAS de dólar (lo que cuesta una llamada).
//
// Una llamada de análisis cuesta ~0,047 USD y un dictado de un minuto
// ~0,006 USD: en centavos las dos redondean a 0 y el cupo no bajaría
// nunca. Y un cupo mensual en millonésimas dentro de un INTEGER se topa en
// 2 147 USD, que es un techo puesto por un tipo de dato y no por nadie.
//
// La conversión vive AQUÍ y en ningún otro sitio.
// ═══════════════════════════════════════════════════════════════════════

/** Millonésimas de dólar que hay en un centavo. */
export const EDU_IA_MICROS_POR_CENTAVO = 10_000;

export function eduIaCentsToMicros(cents: number | null | undefined): number {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) return 0;
  return Math.round(cents) * EDU_IA_MICROS_POR_CENTAVO;
}

/**
 * Tope de VALIDACIÓN de lo que se puede teclear como tope duro: 100 000
 * USD al mes.
 *
 * ⚠️ Esto NO es un precio ni un cupo: es la reja del `<input>`, igual que
 * `EDU_MAX_PRICE_CENTS` de la Ola 5. Existe para que un dedazo (pegar un
 * teléfono en el campo del tope) no se guarde como un techo de siete
 * cifras, y para que el entero de centavos no se desborde.
 */
export const EDU_IA_MAX_TOPE_USD_CENTS = 100_000 * 100;

/**
 * Millonésimas → "1,234.56 USD". Para CANTIDADES de presupuesto (el cupo,
 * lo consumido, lo que queda), donde cuatro decimales serían ruido.
 *
 * Un valor que no es un número finito se pinta "—" y no "NaN USD": una
 * pantalla que dice "no hay dato" es correcta; una que dice NaN es un
 * error de software delante de quien administra la escuela.
 */
export function eduIaUsdLabel(micros: number | null | undefined): string {
  if (typeof micros !== "number" || !Number.isFinite(micros)) return "—";
  const usd = micros / 1_000_000;
  return `${usd.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USD`;
}

/**
 * "0.0184 USD" — para el costo de UNA llamada, donde los centavos no
 * alcanzan. null → raya.
 */
export function eduIaCostoLabel(micros: number | null | undefined): string {
  if (typeof micros !== "number" || !Number.isFinite(micros) || micros < 0) return "—";
  return `${(micros / 1_000_000).toFixed(4)} USD`;
}

/** Centavos de dólar → "1234.50", el valor de un `<input>` (sin comas). */
export function eduIaUsdInputValue(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

/**
 * Lo que teclea una persona → centavos de dólar. Reusa el lector de la
 * Ola 5 (`parseEduMoneyCents`, src/lib/edu/dinero-core.ts) en vez de
 * copiarlo: es unidad-agnóstico —lee un decimal de dos cifras y devuelve
 * centésimas enteras— y ya sabe de los espacios raros que pega Excel, de
 * los separadores de miles y de que no se puede redondear con coma
 * flotante. Una segunda copia habría divergido en el primer arreglo.
 */
export function parseEduIaUsdCents(raw: unknown): number | null {
  return parseEduMoneyCents(raw);
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL PERIODO: A QUÉ MES SE CARGA UN GASTO
// ═══════════════════════════════════════════════════════════════════════

/**
 * El mes al que se imputa un instante, EN LA ZONA DEL INSTITUTO ("2026-08").
 *
 * 🔴 La zona importa. Un dictado a las 23:30 del 31 de agosto en Tijuana
 * son las 06:30 del 1 de septiembre en UTC: cargarlo a septiembre le
 * comería a la escuela cupo del mes que no era, y el 1 de cada mes se
 * vería como un salto inexplicable.
 */
export function eduIaPeriodKey(instant: Date, timeZone: string): string {
  const tz = eduSafeTimeZone(timeZone);
  return eduUtcToZoned(instant, tz).dayISO.slice(0, 7);
}

/** "2026-08" → "agosto de 2026". Vacío o basura → el crudo, nunca "NaN". */
export function eduIaPeriodoLabel(periodKey: string | null | undefined): string {
  const raw = String(periodKey ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return raw || "—";
  const [y, m] = raw.split("-").map(Number);
  if (m < 1 || m > 12) return raw;
  // timeZone UTC a propósito: es un mes de calendario, no un instante.
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA TARIFA
// ═══════════════════════════════════════════════════════════════════════

/**
 * QUÉ MODELO usa cada función, y en qué se mide lo que consume.
 *
 * 🔴 Esto NO es un precio: es la CLAVE con la que se busca el precio. Vive
 * aquí, en un solo sitio, porque tres cosas distintas la necesitan y tienen
 * que coincidir exactamente:
 *
 *   · la llamada al proveedor (src/lib/edu/ia.ts);
 *   · la búsqueda de la tarifa en `edu_ai_prices` (ia-cupo.ts);
 *   · el renglón del gasto, que guarda el modelo que atendió la llamada.
 *
 * Si se cambia el modelo de una función y no se le da de alta su tarifa,
 * la función se APAGA con el motivo "falta configurar la tarifa" — en vez
 * de correr con el precio de otro modelo, que es el fallo silencioso y
 * caro. Buscar la tarifa solo por FUNCIÓN habría hecho exactamente eso:
 * una fila de un modelo viejo, más barato, seguiría cobrando por uno nuevo.
 *
 * La `unit` también se compara: una tarifa de dictado dada de alta en
 * TOKEN describe otra cosa que la que se le está midiendo, y aceptarla
 * daría un número que se lee bien y significa otra cosa.
 */
export const EDU_IA_MODELOS: Record<EduAiFeature, { model: string; unit: EduAiUnit }> = {
  // El que manda `transcribeAudio` (src/lib/integrations/whisper.ts).
  DICTADO: { model: "whisper-1", unit: "SECOND" },
  // El de EDU_ANALISIS_MODEL en src/lib/edu/ia.ts.
  ANALISIS: { model: "claude-opus-5", unit: "TOKEN" },
};

/**
 * La tarifa de un modelo, tal como viaja del servidor a la pantalla. Es un
 * espejo de una fila de `edu_ai_prices` — NO una constante.
 */
export interface EduIaPrecio {
  feature: EduAiFeature;
  model: string;
  unit: EduAiUnit;
  /** Millonésimas de dólar por MILLÓN de unidades de entrada. */
  inUsdMicrosPerMillion: number;
  /** Lo mismo para la salida. En el dictado va en cero. */
  outUsdMicrosPerMillion: number;
  source: string | null;
}

/**
 * Lo que costó una llamada, en MILLONÉSIMAS de dólar enteras.
 *
 * Enteras y no coma flotante por lo mismo que la Ola 5 guarda centavos:
 * sumar dinero en `float` acumula error, y un reporte de gasto que no
 * cuadra por céntimos es un reporte en el que nadie confía.
 *
 * 🔴 Devuelve `null` si no hay tarifa. No devuelve 0 — y ésa es toda la
 * diferencia: un 0 se sumaría al cupo como "esta llamada fue gratis", que
 * es exactamente lo contrario de lo que pasó. Quien llama tiene que
 * tratar el null como "esto no se puede cobrar, así que no se hace".
 */
export function eduIaCosto(
  precio: EduIaPrecio | null | undefined,
  inputUnits: number,
  outputUnits: number,
): number | null {
  if (!precio || typeof precio !== "object") return null;
  const inU = Number.isFinite(inputUnits) && inputUnits > 0 ? inputUnits : 0;
  const outU = Number.isFinite(outputUnits) && outputUnits > 0 ? outputUnits : 0;
  const inP = Number.isFinite(precio.inUsdMicrosPerMillion) ? precio.inUsdMicrosPerMillion : 0;
  const outP = Number.isFinite(precio.outUsdMicrosPerMillion) ? precio.outUsdMicrosPerMillion : 0;
  return Math.max(0, Math.round((inU * inP + outU * outP) / 1_000_000));
}

/** "5.00 USD por millón de tokens" — para la tabla de tarifas del panel. */
export function eduIaPrecioLabel(perMillion: number | null | undefined, unit: EduAiUnit): string {
  if (typeof perMillion !== "number" || !Number.isFinite(perMillion) || perMillion <= 0) {
    return "—";
  }
  const usd = perMillion / 1_000_000;
  const cantidad = usd.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${cantidad} USD por millón de ${EDU_AI_UNIT_PLURAL[unit] ?? "unidades"}`;
}

export const EDU_AI_UNIT_PLURAL: Record<EduAiUnit, string> = {
  TOKEN: "tokens",
  SECOND: "segundos de audio",
};

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL CUPO
// ═══════════════════════════════════════════════════════════════════════

/**
 * El cupo del instituto MÁS lo que lleva consumido este mes, tal como
 * viaja a la pantalla.
 *
 * 🔴 `consumidoUsdMicros` NO sale de ninguna columna: se CUENTA sumando
 * `edu_ai_usage` del periodo cada vez que alguien pregunta. Es la misma
 * decisión que el avance académico de la Ola 6, y por la misma razón: un
 * contador guardado se desincroniza el día que una escritura falle a la
 * mitad, y entonces o se le apaga la IA a una escuela que sí tenía cupo, o
 * se le regala el que ya gastó.
 */
export interface EduIaCupo {
  /** El mes que se está midiendo, "2026-08". */
  periodo: string;
  periodoLabel: string;
  /** Lo que INCLUYE el contrato al mes, en centavos de dólar. */
  incluidoUsdCents: number;
  /** ¿La escuela autoriza gastar más de lo incluido? */
  permiteExcedente: boolean;
  /** El techo TOTAL del mes cuando se permite excedente. */
  topeUsdCents: number | null;
  /** El apagador de la escuela. */
  encendido: boolean;
  /** A quién pedirle más cupo, escrito por la escuela. */
  contacto: string | null;
  /** Lo consumido en el periodo, en millonésimas de dólar. */
  consumidoUsdMicros: number;
  /** Quién tocó el cupo por última vez, y cuándo. */
  actualizadoPor: string | null;
  actualizadoLabel: string | null;
}

/** Lo que el contrato incluye, en millonésimas. */
export function eduIaIncluidoUsdMicros(cupo: EduIaCupo): number {
  return eduIaCentsToMicros(cupo?.incluidoUsdCents);
}

/**
 * El TECHO efectivo del mes, en millonésimas.
 *
 * Sin excedente permitido, el techo es lo incluido. Con excedente
 * permitido, es el tope duro — y se toma el MAYOR de los dos como
 * cinturón: una fila escrita por SQL con un tope por debajo de lo incluido
 * haría que "permitir excederse" REDUJERA el cupo, que es lo contrario de
 * lo que esa casilla dice. El servidor ya rechaza guardarla así; esto es
 * para las filas que no pasaron por el servidor.
 */
export function eduIaTechoUsdMicros(cupo: EduIaCupo): number {
  const incluido = eduIaIncluidoUsdMicros(cupo);
  if (!cupo?.permiteExcedente || typeof cupo.topeUsdCents !== "number") return incluido;
  return Math.max(incluido, eduIaCentsToMicros(cupo.topeUsdCents));
}

/** Lo que queda del mes, en millonésimas. Nunca negativo. */
export function eduIaRestanteUsdMicros(cupo: EduIaCupo): number {
  const consumido =
    typeof cupo?.consumidoUsdMicros === "number" && Number.isFinite(cupo.consumidoUsdMicros)
      ? Math.max(0, cupo.consumidoUsdMicros)
      : 0;
  return Math.max(0, eduIaTechoUsdMicros(cupo) - consumido);
}

/** ¿Ya no cabe ni una llamada más este mes? */
export function eduIaCupoAgotado(cupo: EduIaCupo): boolean {
  return eduIaRestanteUsdMicros(cupo) <= 0;
}

/**
 * Qué porcentaje del techo se lleva gastado, 0–100 (acotado para la barra).
 * Sin techo (cupo de cero) devuelve 100: no queda nada, y una barra vacía
 * diría lo contrario.
 */
export function eduIaPorcentajeUsado(cupo: EduIaCupo): number {
  const techo = eduIaTechoUsdMicros(cupo);
  if (techo <= 0) return 100;
  const consumido = Math.max(0, cupo?.consumidoUsdMicros ?? 0);
  return Math.min(100, Math.round((consumido / techo) * 100));
}

/**
 * Dónde cae la marca de "lo que incluye el contrato" dentro de la barra,
 * 0–100. Solo tiene sentido cuando hay excedente permitido: es la línea
 * que separa "lo que pagaste" de "lo que estás gastando de más".
 */
export function eduIaMarcaIncluido(cupo: EduIaCupo): number | null {
  const techo = eduIaTechoUsdMicros(cupo);
  const incluido = eduIaIncluidoUsdMicros(cupo);
  if (techo <= 0 || incluido <= 0 || incluido >= techo) return null;
  return Math.round((incluido / techo) * 100);
}

/** ¿Lo consumido ya pasó de lo que incluye el contrato? */
export function eduIaEnExcedente(cupo: EduIaCupo): boolean {
  const incluido = eduIaIncluidoUsdMicros(cupo);
  return incluido > 0 && (cupo?.consumidoUsdMicros ?? 0) > incluido;
}

/** Lo que la ESCUELA quiere dejar guardado, ya leído del cuerpo. */
export interface EduIaCupoCambio {
  /** Lo que incluye el contrato. Se pasa para poder comparar; no se edita. */
  incluidoUsdCents: number;
  permiteExcedente: boolean;
  topeUsdCents: number | null;
}

/**
 * LAS DOS REGLAS DEL EXCEDENTE, en una función pura.
 *
 * Devuelve `null` si el cambio es válido, o el mensaje —escrito para una
 * persona— de por qué no lo es.
 *
 * 🔴 Vive AQUÍ y no dentro del `update` de Prisma por una razón concreta:
 * una regla que solo existe pegada a una consulta solo se puede comprobar
 * con una base de datos delante, y una regla que no se comprueba es una
 * regla que se rompe en el primer refactor. Las dos que decide esta
 * función son las que sostienen el cupo:
 *
 *   1. permitir excederse EXIGE tope. "Permitido, sin tope" es exactamente
 *      la fuga que la Ola 3B se negó a abrir: 120 alumnos con el micrófono
 *      abierto y una factura que nadie puede contestar.
 *   2. el tope tiene que ser MAYOR que lo incluido. Un tope por debajo
 *      haría que marcar "permitir gastar de más" REDUJERA el cupo, que es
 *      lo contrario de lo que dice la casilla.
 *
 * ⚠️ No valida lo incluido, y no es un olvido: eso no se edita desde el
 * panel con ningún permiso (ver src/lib/edu/ia-cupo.ts).
 */
export function eduIaValidarCupo(cambio: EduIaCupoCambio): string | null {
  if (!cambio || typeof cambio !== "object") return "No se pudo leer el cambio del cupo.";
  if (!cambio.permiteExcedente) return null;

  if (typeof cambio.topeUsdCents !== "number" || !Number.isFinite(cambio.topeUsdCents)) {
    return (
      "Para permitir gastar de más hace falta un TOPE. Sin tope, un mes con mucha actividad " +
      "puede acabar en una factura que nadie puede contestar — que es exactamente lo que este " +
      "cupo existe para evitar."
    );
  }

  if (cambio.topeUsdCents <= cambio.incluidoUsdCents) {
    return (
      `El tope tiene que ser MAYOR que lo que incluye tu contrato (${eduIaUsdLabel(
        eduIaCentsToMicros(cambio.incluidoUsdCents),
      )}). Un tope por debajo no permitiría gastar de más: reduciría el cupo.`
    );
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL ESTADO DE UNA FUNCIÓN — el único interruptor del producto
// ═══════════════════════════════════════════════════════════════════════

/**
 * Por qué una función de IA no está disponible. Es un conjunto CERRADO
 * para que la pantalla no tenga que adivinar con un `if (mensaje.includes)`.
 */
export type EduIaMotivo =
  /** Está disponible. */
  | "ok"
  /** Freno de emergencia global de DaleControl (EDU_IA_ENABLED=0). */
  | "suspendida"
  /** El instituto no tiene fila de cupo: su contrato no incluye IA. */
  | "sin_cupo"
  /** La dirección del instituto la apagó desde /instituto/ia. */
  | "apagada"
  /** No hay tarifa configurada para el modelo que esta función usa. */
  | "sin_precio"
  /** Falta la llave del proveedor en este entorno. */
  | "sin_llave"
  /** Se acabó el cupo del mes. */
  | "cupo_agotado";

export interface EduIaEstado {
  feature: EduAiFeature;
  disponible: boolean;
  motivo: EduIaMotivo;
  /** Una línea, para el botón deshabilitado o el `title`. */
  titulo: string;
  /** El párrafo honesto, para el panel que lo explica. */
  detalle: string;
  /** Lo consumido del mes, ya formateado. null cuando no hay cupo que leer. */
  consumidoLabel: string | null;
  /** El techo del mes, ya formateado. */
  techoLabel: string | null;
  /** A quién pedirle más cupo, si la escuela lo escribió. */
  contacto: string | null;
}

/**
 * Todo lo que hace falta para decidir. Se pasa como DATO (no se lee
 * `process.env` ni se consulta la base aquí) porque este módulo lo importa
 * una pantalla "use client": en el navegador `process.env.EDU_IA_ENABLED`
 * no existe y `prisma` tampoco, y una función que los consultara
 * devolvería "apagado" siempre — que es peor que devolver un error, porque
 * parece un dato.
 */
export interface EduIaSituacion {
  /** Freno global de DaleControl. false = apagada en TODAS las escuelas. */
  global: boolean;
  /** OPENAI_API_KEY presente (Whisper, el dictado). */
  openaiConfigurado: boolean;
  /** ANTHROPIC_API_KEY presente (Claude con visión, el análisis). */
  anthropicConfigurado: boolean;
  /** El cupo del instituto. null = no tiene fila: la IA está apagada. */
  cupo: EduIaCupo | null;
  /** La tarifa vigente de cada función. null = sin tarifa, no se puede cobrar. */
  precios: Record<EduAiFeature, EduIaPrecio | null>;
}

const TITULO: Record<EduIaMotivo, string> = {
  ok: "Disponible",
  suspendida: "Apagada temporalmente por DaleControl",
  sin_cupo: "Tu contrato todavía no incluye IA",
  apagada: "Apagada por la dirección del instituto",
  sin_precio: "Falta configurar la tarifa de este modelo",
  sin_llave: "Falta la llave del proveedor en este entorno",
  cupo_agotado: "Se acabó el cupo de IA de este mes",
};

const DETALLE_SUSPENDIDA =
  "DaleControl apagó la IA de todos los institutos de forma temporal (variable de " +
  "entorno EDU_IA_ENABLED). No es tu cupo ni tu contrato: escríbenos y te decimos " +
  "cuándo vuelve. Mientras tanto, la nota se escribe a mano y la placa se lee como " +
  "siempre.";

const DETALLE_SIN_CUPO =
  "Esta función está construida y probada, pero consume tokens de IA que cuestan " +
  "dinero, y el contrato de tu instituto todavía no trae cupo de IA asignado. No se " +
  "enciende con una variable de entorno: hay que darle de alta su cupo mensual. " +
  "Pídeselo a DaleControl —es un renglón del contrato— y en cuanto esté, el micrófono " +
  "y el análisis funcionan sin tocar nada más.";

const DETALLE_APAGADA =
  "La dirección del instituto tiene la IA apagada desde la pantalla de Consumo de IA. " +
  "El cupo sigue ahí: apagarla no lo borra. Si la necesitas, pídele a la dirección que " +
  "la vuelva a encender.";

const DETALLE_SIN_PRECIO =
  "El modelo que usa esta función no tiene tarifa configurada, así que no se puede " +
  "saber cuánto costaría cada llamada ni descontarla del cupo del instituto. La " +
  "función se queda apagada a propósito: correr sin poder cobrar dejaría el cupo " +
  "diciendo que no se ha gastado nada mientras la factura del proveedor sube. Es un " +
  "renglón de la tabla de tarifas (edu_ai_prices) que le toca poner a DaleControl.";

const DETALLE_SIN_LLAVE: Record<EduAiFeature, string> = {
  DICTADO:
    "El dictado usa Whisper (OpenAI) y este entorno no tiene OPENAI_API_KEY. " +
    "Sin esa llave no hay transcripción que hacer; escribe la nota a mano " +
    "mientras tanto.",
  ANALISIS:
    "El análisis usa Claude con visión (Anthropic) y este entorno no tiene " +
    "ANTHROPIC_API_KEY. Sin esa llave no hay análisis que pedir.",
};

/**
 * El mensaje de CUPO AGOTADO. Es el que más se va a leer, así que dice las
 * tres cosas que hacen falta para hacer algo con él: cuánto se consumió,
 * de cuánto, y a quién pedirle más.
 *
 * 🔴 Sin esas tres cosas, un alumno con el micrófono muerto abre un ticket
 * — y ese ticket cuesta más que el cupo que se acabó.
 *
 * ⚠️ SÍ, ESTO LE ENSEÑA UNA CIFRA A UN ALUMNO, y hay que decir por qué no
 * contradice la regla de la Ola 5 ("un alumno no ve dinero"). Lo que
 * aquella regla cierra es el dinero de los PACIENTES —precios, cobros,
 * saldos—, porque un alumno que sabe cuánto pagó su paciente sabe
 * cuánto vale su propia lista de espera, y ése es el incentivo que la
 * escuela no quiere crear. Esto es otra cosa: es el presupuesto de una
 * HERRAMIENTA de la escuela, y es exactamente el dato que convierte "el
 * micrófono no funciona" en "ya se gastó el cupo del mes, habla con
 * fulano". El desglose de QUIÉN se lo gastó sí queda cerrado: eso vive en
 * /instituto/ia, detrás de `ia.view` y del alcance del dinero.
 */
function detalleCupoAgotado(cupo: EduIaCupo): string {
  const consumido = eduIaUsdLabel(cupo.consumidoUsdMicros);
  const techo = eduIaUsdLabel(eduIaTechoUsdMicros(cupo));
  const partes: string[] = [
    `El instituto lleva consumidos ${consumido} de los ${techo} de IA de ${cupo.periodoLabel}, ` +
      "así que esta función se apaga hasta el mes que viene.",
  ];
  if (!cupo.permiteExcedente) {
    partes.push(
      "La dirección puede autorizar pasar del cupo incluido —con un tope— desde la " +
        "pantalla de Consumo de IA.",
    );
  } else {
    partes.push("Ya se alcanzó el tope que la dirección autorizó para este mes.");
  }
  partes.push(
    cupo.contacto
      ? `A quién pedirle más: ${cupo.contacto}.`
      : "Para pedir más, habla con la dirección del instituto.",
  );
  partes.push("Mientras tanto, la nota se escribe a mano: no se pierde nada de lo que llevas.");
  return partes.join(" ");
}

const DETALLE_OK =
  "Consume cupo de IA del instituto. Cada uso queda registrado con tu nombre en " +
  "Consumo de IA, así que se puede contestar en qué se fue el cupo.";

function estadoBase(feature: EduAiFeature, cupo: EduIaCupo | null) {
  return {
    feature,
    consumidoLabel: cupo ? eduIaUsdLabel(cupo.consumidoUsdMicros) : null,
    techoLabel: cupo ? eduIaUsdLabel(eduIaTechoUsdMicros(cupo)) : null,
    contacto: cupo?.contacto ?? null,
  };
}

/**
 * El estado de UNA función.
 *
 * 🔴 EL ORDEN DE LAS COMPROBACIONES ES PARTE DEL DISEÑO, no una casualidad
 * de cómo salió el `if`. Va de "esta escuela no puede usar esto nunca" a
 * "no puede usarlo ahora mismo", para que quien lee el mensaje arregle
 * primero lo que de verdad bloquea:
 *
 *   1. el freno global      → no es asunto de la escuela;
 *   2. no hay cupo          → falta un renglón del CONTRATO;
 *   3. la escuela lo apagó  → lo arregla la dirección en un clic;
 *   4. no hay tarifa        → falta configurar el producto;
 *   5. falta la llave       → falta configurar el entorno;
 *   6. se acabó el cupo     → lo único que depende del mes en curso.
 *
 * Si el cupo agotado se comprobara ANTES que la llave, un entorno a medio
 * desplegar diría "pide más cupo" cuando pedir más cupo no arreglaría
 * nada. Y si la llave se comprobara antes que el cupo, una escuela sin
 * contrato de IA mandaría a su director a buscar a un ingeniero.
 */
export function eduIaEstado(feature: EduAiFeature, situacion: EduIaSituacion): EduIaEstado {
  // Cinturón: si llega cualquier cosa que no es una situación, se apaga.
  // Lo ambiguo, en una función que abre el grifo del gasto, es "no".
  if (!situacion || typeof situacion !== "object") {
    return {
      ...estadoBase(feature, null),
      disponible: false,
      motivo: "sin_cupo",
      titulo: TITULO.sin_cupo,
      detalle: DETALLE_SIN_CUPO,
    };
  }

  const cupo = situacion.cupo ?? null;
  const base = estadoBase(feature, cupo);

  if (!situacion.global) {
    return {
      ...base,
      disponible: false,
      motivo: "suspendida",
      titulo: TITULO.suspendida,
      detalle: DETALLE_SUSPENDIDA,
    };
  }

  if (!cupo) {
    return {
      ...base,
      disponible: false,
      motivo: "sin_cupo",
      titulo: TITULO.sin_cupo,
      detalle: DETALLE_SIN_CUPO,
    };
  }

  if (!cupo.encendido) {
    return {
      ...base,
      disponible: false,
      motivo: "apagada",
      titulo: TITULO.apagada,
      detalle: DETALLE_APAGADA,
    };
  }

  const precio = situacion.precios ? situacion.precios[feature] : null;
  if (!precio) {
    return {
      ...base,
      disponible: false,
      motivo: "sin_precio",
      titulo: TITULO.sin_precio,
      detalle: DETALLE_SIN_PRECIO,
    };
  }

  const llave = feature === "DICTADO" ? situacion.openaiConfigurado : situacion.anthropicConfigurado;
  if (!llave) {
    return {
      ...base,
      disponible: false,
      motivo: "sin_llave",
      titulo: TITULO.sin_llave,
      detalle: DETALLE_SIN_LLAVE[feature],
    };
  }

  if (eduIaCupoAgotado(cupo)) {
    return {
      ...base,
      disponible: false,
      motivo: "cupo_agotado",
      titulo: TITULO.cupo_agotado,
      detalle: detalleCupoAgotado(cupo),
    };
  }

  return {
    ...base,
    disponible: true,
    motivo: "ok",
    titulo: TITULO.ok,
    detalle: `${DETALLE_OK} Quedan ${eduIaUsdLabel(eduIaRestanteUsdMicros(cupo))} de ${
      base.techoLabel
    } en ${cupo.periodoLabel}.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// EL DICTADO
// ═══════════════════════════════════════════════════════════════════════

/** Tope por grabación, en segundos. El mismo que el dental. */
export const EDU_DICTADO_MAX_SECONDS = 60;

/**
 * Tope de bytes del audio. 4 MB, por debajo del corte de ~4.5 MB que
 * Vercel le hace al cuerpo de una petición. A 64 kbps, 60 segundos pesan
 * ~0.5 MB: el tope solo lo alcanza un cliente que mande otra cosa.
 */
export const EDU_DICTADO_MAX_BYTES = 4 * 1024 * 1024;

/**
 * MIME normalizado (sin ";codecs=") que se acepta. "" está en la lista
 * porque algunos navegadores no reportan tipo, y "video/mp4" porque es la
 * etiqueta que iOS/Safari le pone al audio de MediaRecorder.
 */
export const EDU_DICTADO_MIMES = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-m4a",
  "video/mp4",
  "",
];

export function eduDictadoMimeOk(raw: string | null | undefined): boolean {
  const mime = String(raw ?? "").split(";")[0].trim().toLowerCase();
  return EDU_DICTADO_MIMES.includes(mime);
}

/**
 * Pista de vocabulario para Whisper. Es la del dental MÁS lo que se dicta
 * en una escuela: el residente nombra a su docente, su unidad y su
 * programa, y sin la pista salen transcritos como cualquier cosa.
 */
export const EDU_DICTADO_HINT =
  "Dictado clínico dental en español (México), en una clínica de enseñanza " +
  "universitaria: diagnóstico, plan de tratamiento, odontograma, profilaxis, " +
  "resina, endodoncia, corona, extracción, periodontitis, gingivitis, oclusión, " +
  "amoxicilina, ibuprofeno, radiografía periapical, tomografía, docente, " +
  "supervisor, residente, sillón, tamizaje, expediente.";

// ═══════════════════════════════════════════════════════════════════════
// EL ANÁLISIS RADIOGRÁFICO
// ═══════════════════════════════════════════════════════════════════════

/**
 * 🔴 ES APOYO, NO DIAGNÓSTICO. Esta constante la pinta la pantalla ENTERA
 * y sin poder cerrarse, y el texto vive aquí para que la pantalla y el
 * endpoint digan lo mismo.
 *
 * La regla que la acompaña es más importante que el aviso: el resultado de
 * la IA NUNCA se escribe solo dentro de una nota clínica. Queda como
 * anotación aparte, y si el alumno quiere usar algo, lo copia y lo escribe
 * él — con su nombre encima. Es el mismo criterio que el aiAssist del
 * dental, que no toca el S/O/A/P.
 */
export const EDU_ANALISIS_AVISO =
  "Esto es APOYO diagnóstico, no un diagnóstico. Lo que sigue lo escribió un " +
  "modelo de lenguaje mirando la imagen: puede equivocarse, puede ver lo que no " +
  "hay y puede callarse lo que sí. No sustituye tu lectura ni la de tu docente, " +
  "y no se guarda dentro de ninguna nota clínica: queda aquí, aparte, y tú " +
  "decides si algo de esto entra a tu nota escrito por ti.";

/**
 * Tope de la imagen que se le manda al modelo: 5 MB del objeto real.
 *
 * No es un capricho nuestro sino el techo práctico de la API de visión, y
 * comprobarlo ANTES de descargar 600 MB de una tomografía es la diferencia
 * entre un mensaje claro y un timeout.
 */
export const EDU_ANALISIS_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Los formatos que la API de visión acepta. */
export const EDU_ANALISIS_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function eduAnalisisMimeOk(raw: string | null | undefined): boolean {
  return EDU_ANALISIS_MIMES.includes(String(raw ?? "").trim().toLowerCase());
}

/** Techo de análisis que se listan de un estudio. */
export const EDU_ANALISIS_MAX_ROWS = 20;

/** Severidad tal como la devuelve el modelo, normalizada a español. */
export const EDU_SEVERIDAD_LABELS: Record<string, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Medio",
  low: "Bajo",
  informational: "Informativo",
  // Aliases en español que el dental todavía acepta de respuestas viejas.
  alta: "Alto",
  media: "Medio",
  baja: "Bajo",
  informativo: "Informativo",
};

export function eduSeveridadLabel(raw: string | null | undefined): string {
  const k = String(raw ?? "").trim().toLowerCase();
  return EDU_SEVERIDAD_LABELS[k] ?? "Sin clasificar";
}

/** Clase de la píldora de severidad (las del tema del vertical). */
export function eduSeveridadTag(raw: string | null | undefined): string {
  const k = String(raw ?? "").trim().toLowerCase();
  if (k === "critical") return "edu-tag--danger";
  if (k === "high" || k === "alta") return "edu-tag--danger";
  if (k === "medium" || k === "media") return "edu-tag--warn";
  if (k === "low" || k === "baja") return "edu-tag--info";
  return "edu-tag--muted";
}

/** 0–1 → "87 %". Un hallazgo sin confianza legible sale como raya. */
export function eduConfianzaLabel(raw: number | null | undefined): string {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return "—";
  // El dental guardó en algún momento la confianza en 0–100 y en otro en
  // 0–1. Se acepta lo que venga: por encima de 1 se asume porcentaje.
  const pct = raw > 1 ? raw : raw * 100;
  return `${Math.round(Math.min(100, pct))} %`;
}

// ═══════════════════════════════════════════════════════════════════════
// LA FORMA QUE VIAJA A LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

export interface EduAnalisisHallazgo {
  id: string;
  title: string;
  description: string;
  tooth: string | null;
  severity: string;
  confidence: number | null;
  confidenceRationale: string | null;
}

export interface EduAnalisisRow {
  id: string;
  studyId: string;
  summary: string;
  hallazgos: EduAnalisisHallazgo[];
  recomendaciones: string[];
  severity: string;
  confidence: number | null;
  modelUsed: string;
  tokensUsed: number;
  /** Costo estimado en millonésimas de dólar. null = no se pudo calcular. */
  costUsdMicros: number | null;
  requestedByName: string;
  createdAt: string;
  createdLabel: string;
}

/**
 * Normaliza lo que devolvió el modelo a la forma de la pantalla.
 *
 * Vive aquí (módulo puro) y no en el servidor porque lo usan los dos: el
 * endpoint al guardar y la pantalla al leer una fila vieja. Un modelo que
 * un día devuelva `recommendations` como string en vez de array no puede
 * dejar la pestaña en blanco.
 */
export function eduAnalisisHallazgos(raw: unknown): EduAnalisisHallazgo[] {
  if (!Array.isArray(raw)) return [];
  const out: EduAnalisisHallazgo[] = [];
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i];
    if (typeof f !== "object" || f === null) continue;
    const o = f as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!title) continue;
    out.push({
      id: typeof o.id === "string" || typeof o.id === "number" ? String(o.id) : String(i + 1),
      title: title.slice(0, 200),
      description: typeof o.description === "string" ? o.description.trim().slice(0, 2000) : "",
      tooth: typeof o.tooth === "string" && o.tooth.trim() ? o.tooth.trim().slice(0, 12) : null,
      severity: typeof o.severity === "string" ? o.severity.trim().toLowerCase() : "informational",
      confidence: typeof o.confidence === "number" && Number.isFinite(o.confidence) ? o.confidence : null,
      confidenceRationale:
        typeof o.confidenceRationale === "string" && o.confidenceRationale.trim()
          ? o.confidenceRationale.trim().slice(0, 500)
          : null,
    });
  }
  return out;
}

/** `recommendations` puede llegar como array o como un solo string. */
export function eduAnalisisRecomendaciones(raw: unknown): string[] {
  if (typeof raw === "string") {
    const v = raw.trim();
    return v ? [v.slice(0, 1000)] : [];
  }
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const v = r.trim();
    if (v) out.push(v.slice(0, 1000));
  }
  return out;
}

/**
 * El análisis, en texto plano, para que el alumno lo COPIE y decida qué
 * escribir en su nota.
 *
 * 🔴 Esta función es la única forma en que el resultado de la IA llega a
 * una nota clínica: pasando por el portapapeles y por la persona. No hay
 * ningún camino en el producto que escriba esto dentro de un EduRecord.
 */
export function eduAnalisisComoTexto(a: EduAnalisisRow): string {
  const lineas: string[] = [];
  lineas.push(`Apoyo de IA (${a.modelUsed}) — ${a.createdLabel}`);
  lineas.push("NO es un diagnóstico. Revisar antes de usar.");
  lineas.push("");
  if (a.summary) {
    lineas.push(a.summary);
    lineas.push("");
  }
  if (a.hallazgos.length > 0) {
    lineas.push("Hallazgos:");
    for (const h of a.hallazgos) {
      const diente = h.tooth ? ` (pieza ${h.tooth})` : "";
      lineas.push(
        `• ${h.title}${diente} — ${eduSeveridadLabel(h.severity)}, confianza ${eduConfianzaLabel(h.confidence)}`,
      );
      if (h.description) lineas.push(`  ${h.description}`);
    }
    lineas.push("");
  }
  if (a.recomendaciones.length > 0) {
    lineas.push("Recomendaciones:");
    for (const r of a.recomendaciones) lineas.push(`• ${r}`);
  }
  return lineas.join("\n").trim();
}

/**
 * Lo que el instituto le agrega al prompt del dental.
 *
 * 🔴 Se CONCATENA, no se edita: el prompt base y el esquema de la
 * herramienta se importan de src/lib/xray/analysis-modes.ts (módulo puro
 * del dental) para que la calibración de confianza y la lista de hallazgos
 * sean LAS MISMAS en los dos productos. Si la escuela tuviera su propia
 * copia, la corrección que el dental le haga mañana a esa calibración no
 * llegaría aquí, y la lectura de la escuela sería peor sin que nadie se
 * enterara.
 *
 * Lo que cambia es el LECTOR: allá lo revisa un doctor titulado, aquí un
 * alumno en formación al que un modelo demasiado seguro puede convencer.
 */
export const EDU_ANALISIS_SYSTEM_EXTRA = `
CONTEXTO INSTITUCIONAL — LÉELO ANTES DE RESPONDER.
Quien va a leer tu respuesta es un ESTUDIANTE de una especialidad odontológica, en formación, dentro de una clínica universitaria, y su docente responsable la revisará después. No es el diagnóstico: es apoyo para que el estudiante mire mejor la imagen.
Por eso:
- No des por cerrado nada. Cuando un hallazgo admita más de una explicación, dilo en la descripción.
- Cuando la proyección, el encuadre o el contraste no permitan sostener un hallazgo, dilo y recomiéndale la proyección que sí lo permitiría, en vez de bajar la confianza sin explicar.
- Recomienda SIEMPRE confirmar clínicamente y consultarlo con el docente antes de tratar.
- No propongas dosis de medicamentos ni indicaciones de receta.`.trim();

// ═══════════════════════════════════════════════════════════════════════
// 6 · LO QUE PINTA /instituto/ia
// ═══════════════════════════════════════════════════════════════════════

/** Techo de renglones de detalle que se listan. */
export const EDU_IA_MAX_USOS = 200;

/** Un uso suelto, para el detalle. */
export interface EduIaUsoRow {
  id: string;
  feature: EduAiFeature;
  featureLabel: string;
  userName: string;
  userRole: EduRole;
  targetLabel: string | null;
  model: string;
  unit: EduAiUnit;
  inputUnits: number;
  outputUnits: number;
  costUsdMicros: number;
  costLabel: string;
  isEstimated: boolean;
  createdAt: string;
  createdLabel: string;
}

/** Cuánto se gastó una PERSONA en el mes. */
export interface EduIaPersonaRow {
  /** null = la cuenta ya no existe; el nombre congelado sigue valiendo. */
  userId: string | null;
  userName: string;
  userRole: EduRole;
  usos: number;
  costUsdMicros: number;
  costLabel: string;
  /** Qué porcentaje del gasto del mes es suyo (0–100). */
  porcentaje: number;
}

/** Cuánto se gastó en una FUNCIÓN en el mes. */
export interface EduIaFuncionRow {
  feature: EduAiFeature;
  featureLabel: string;
  usos: number;
  costUsdMicros: number;
  costLabel: string;
  porcentaje: number;
  /** Unidades consumidas (tokens o segundos), para poder dimensionarlo. */
  unidades: number;
  unit: EduAiUnit;
  unidadesLabel: string;
}

/** Todo lo que necesita la pantalla, ya resuelto en el servidor. */
export interface EduIaPanel {
  cupo: EduIaCupo | null;
  estados: EduIaEstado[];
  precios: EduIaPrecio[];
  porPersona: EduIaPersonaRow[];
  porFuncion: EduIaFuncionRow[];
  usos: EduIaUsoRow[];
  usosTruncados: boolean;
  /** ¿Esta sesión puede editar el cupo? Lo decide el servidor. */
  puedeEditar: boolean;
}

/**
 * "12,430 tokens" / "1 h 12 min de audio". La unidad se pinta en lo que la
 * persona entiende: nadie sabe cuánto es "4 320 segundos".
 */
export function eduIaUnidadesLabel(unidades: number, unit: EduAiUnit): string {
  const n = Number.isFinite(unidades) && unidades > 0 ? Math.round(unidades) : 0;
  if (unit === "TOKEN") return `${n.toLocaleString("es-MX")} tokens`;
  if (n < 60) return `${n} s de audio`;
  const minutos = Math.floor(n / 60);
  if (minutos < 60) return `${minutos} min de audio`;
  const horas = Math.floor(minutos / 60);
  return `${horas} h ${minutos % 60} min de audio`;
}

/** El porcentaje que representa una parte del total, 0–100 y sin dividir entre cero. */
export function eduIaParte(parte: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((parte / total) * 100)));
}
