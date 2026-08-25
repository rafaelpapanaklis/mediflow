// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · calculadoras — CATÁLOGO DE PARÁMETROS.
//
// Módulo PURO y client-safe (sin Prisma, sin server-only). Aquí viven:
//   1. la forma que tienen los parámetros ya resueltos,
//   2. el resolutor que convierte filas crudas de realty_calc_params en esa
//      forma —o en una lista de lo que FALTA—,
//   3. la semilla con su fuente, su año y su marca de "por verificar".
//
// 🔴 LA REGLA QUE MANDA SOBRE TODO: ningún parámetro fiscal se escribe en
// el código de las calculadoras. La UMA, la UDI, el INPC, las tasas de ISAI
// por estado y los topes de Infonavit CAMBIAN CADA AÑO. Todo vive en la
// tabla realty_calc_params, editable desde /admin/inmobiliarias/parametros,
// con `effectiveFrom` para poder recalcular con el valor que estaba vigente
// el día de la operación.
//
// Lo que hay más abajo NO es una excepción a esa regla: es la SEMILLA que
// el admin escribe UNA vez en la tabla y a partir de ahí edita a mano. Las
// calculadoras jamás la leen; leen la tabla. Si la tabla está vacía, la
// calculadora dice qué falta y pide capturarlo — nunca inventa un número.
//
// ── POR QUÉ EL `meta` CARGA TANTO ────────────────────────────────────────
// El enum RealtyCalcParamKind de la Ola 0 tiene SEIS valores y es contrato
// cerrado (schema.prisma no se toca en esta ola). Pero las calculadoras
// necesitan más de seis familias de números: honorarios notariales, tarifa
// del ISR, crédito bancario, impuesto cedular. La columna `meta Json?`
// existe justo para eso. El mapa completo, para que nadie tenga que
// deducirlo leyendo el código:
//
//   kind        stateCode   value                    meta lleva…
//   ─────────── ─────────── ───────────────────────── ────────────────────
//   ISAI        "MX"        tasa general de refe-     los costos de escri-
//                           rencia (informativa)      turación federales:
//                                                     notario, registro,
//                                                     avalúo, certificados,
//                                                     IVA de honorarios
//   ISAI        "JAL"…      tasa de ESE estado        cedular del estado y
//                                                     sus notas/fuente
//   UMA         "MX"        UMA diaria                mensual y anual
//   UDI         "MX"        valor de la UDI           TODO el bloque de ISR
//                                                     (la exención del 93 se
//                                                     mide en UDIS, así que
//                                                     es su casa natural)
//   INPC        "MX"        índice de diciembre       mes y base del índice
//                           (una fila por año)
//   INFONAVIT   "MX"        monto máximo tradicional  Unamos, tasas, plazo,
//                                                     puntos, edad, factor
//                                                     de pago Y el bloque
//                                                     BANCARIO
//   FOVISSSTE   "MX"        monto máximo              tasas, plazo, edad,
//                                                     factor de pago
// ═══════════════════════════════════════════════════════════════════════
import type { RealtyCalcParamKind } from "@/lib/realty/types";

// ── Estados ────────────────────────────────────────────────────────────
// Claves de tres letras (ISO 3166-2:MX sin el prefijo "MX-"), que es lo que
// el contrato usa en sus ejemplos: "JAL", "CMX". "MX" queda reservado para
// el parámetro FEDERAL, tal como manda el docblock del modelo.

export const FEDERAL_STATE_CODE = "MX";

export interface MxState {
  code: string;
  name: string;
}

export const MX_STATES: MxState[] = [
  { code: "AGU", name: "Aguascalientes" },
  { code: "BCN", name: "Baja California" },
  { code: "BCS", name: "Baja California Sur" },
  { code: "CAM", name: "Campeche" },
  { code: "CHP", name: "Chiapas" },
  { code: "CHH", name: "Chihuahua" },
  { code: "CMX", name: "Ciudad de México" },
  { code: "COA", name: "Coahuila" },
  { code: "COL", name: "Colima" },
  { code: "DUR", name: "Durango" },
  { code: "GUA", name: "Guanajuato" },
  { code: "GRO", name: "Guerrero" },
  { code: "HID", name: "Hidalgo" },
  { code: "JAL", name: "Jalisco" },
  { code: "MEX", name: "Estado de México" },
  { code: "MIC", name: "Michoacán" },
  { code: "MOR", name: "Morelos" },
  { code: "NAY", name: "Nayarit" },
  { code: "NLE", name: "Nuevo León" },
  { code: "OAX", name: "Oaxaca" },
  { code: "PUE", name: "Puebla" },
  { code: "QUE", name: "Querétaro" },
  { code: "ROO", name: "Quintana Roo" },
  { code: "SLP", name: "San Luis Potosí" },
  { code: "SIN", name: "Sinaloa" },
  { code: "SON", name: "Sonora" },
  { code: "TAB", name: "Tabasco" },
  { code: "TAM", name: "Tamaulipas" },
  { code: "TLA", name: "Tlaxcala" },
  { code: "VER", name: "Veracruz" },
  { code: "YUC", name: "Yucatán" },
  { code: "ZAC", name: "Zacatecas" },
];

const STATE_NAME_BY_CODE: Record<string, string> = MX_STATES.reduce(
  (acc, s) => {
    acc[s.code] = s.name;
    return acc;
  },
  {} as Record<string, string>,
);

export function stateName(code: string): string {
  if (code === FEDERAL_STATE_CODE) return "Federal (aplica a todo el país)";
  return STATE_NAME_BY_CODE[code] ?? code;
}

export function isKnownStateCode(code: unknown): boolean {
  return typeof code === "string" && (code === FEDERAL_STATE_CODE || !!STATE_NAME_BY_CODE[code]);
}

function normaliza(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * El estado que la cuenta capturó en su alta ("Jalisco", "CDMX", "Ciudad de
 * México"…) → la clave de tres letras. Sirve para preseleccionar el estado
 * en las calculadoras, que es donde el asesor trabaja el 90% del tiempo.
 * Si no reconoce el texto devuelve el que se le pase de respaldo.
 */
export function stateCodeFromName(raw: string | null | undefined, fallback = "CMX"): string {
  const v = normaliza(String(raw ?? ""));
  if (!v) return fallback;
  if (STATE_NAME_BY_CODE[v.toUpperCase()]) return v.toUpperCase();
  const exacto = MX_STATES.find((s) => normaliza(s.name) === v);
  if (exacto) return exacto.code;
  // Los alias que la gente escribe de verdad.
  const alias: Record<string, string> = {
    cdmx: "CMX",
    df: "CMX",
    "distrito federal": "CMX",
    "mexico city": "CMX",
    edomex: "MEX",
    "estado de mexico": "MEX",
    mexico: "MEX",
    "nuevo leon": "NLE",
    "san luis potosi": "SLP",
    "quintana roo": "ROO",
    "baja california norte": "BCN",
    michoacan: "MIC",
    queretaro: "QUE",
    yucatan: "YUC",
  };
  if (alias[v]) return alias[v];
  const parcial = MX_STATES.find((s) => normaliza(s.name).startsWith(v) && v.length >= 4);
  return parcial ? parcial.code : fallback;
}

/**
 * Primera línea de todo cálculo que se guarda en la bitácora del prospecto.
 * Es lo que permite volver a encontrarlos: RealtyLeadActivity no tiene
 * columna Json, así que el marcador tiene que ir en el propio texto — y por
 * eso está redactado para que se lea bien en la línea de tiempo, no como un
 * código interno.
 */
export const MARCA_BITACORA = "Calculadora · ";

// ── Filas crudas ───────────────────────────────────────────────────────

/**
 * Una fila de realty_calc_params tal como la sirve el servidor. `value` ya
 * viene como number: la columna es Decimal(14,6) y Prisma la entrega como
 * Decimal, así que el lector hace Number(row.value) antes de mandarla al
 * navegador (un Decimal no sobrevive a la serialización RSC).
 */
export interface RawCalcParamRow {
  kind: RealtyCalcParamKind;
  stateCode: string;
  year: number;
  value: number;
  meta: Record<string, unknown> | null;
  /** ISO. Se compara con la fecha de la operación. */
  effectiveFrom: string;
}

/** Lo que falta para poder calcular, en palabras que el usuario entienda. */
export interface CalcFaltante {
  kind: RealtyCalcParamKind;
  stateCode: string;
  /** "Tasa de ISAI de Jalisco", "Valor de la UDI"… */
  etiqueta: string;
  /** Qué tiene que hacer alguien para que esto deje de faltar. */
  comoResolver: string;
}

/**
 * Resultado de resolver parámetros.
 *
 * UNA interfaz con campos opcionales y NO una unión discriminada: el repo
 * compila con `strict: false`, así que TypeScript no estrecha `{ok:true}|
 * {ok:false}` por el campo `ok` y todo acceso a `.params` daría error.
 */
export interface ParamsResolved<T> {
  ok: boolean;
  params?: T;
  faltantes: CalcFaltante[];
  /** Cosas que el usuario debe saber aunque el cálculo sí haya salido. */
  avisos: string[];
}

// ── Formas ya resueltas ────────────────────────────────────────────────

export interface EscrituracionParams {
  /** Año de vigencia de la tasa de ISAI que se usó. */
  year: number;
  stateCode: string;
  stateName: string;
  isaiPct: number;
  isaiFuente: string;
  isaiPorVerificar: boolean;
  isaiNota: string;
  notarioPctMin: number;
  notarioPctMax: number;
  registroPctMin: number;
  registroPctMax: number;
  avaluoPctMin: number;
  avaluoPctMax: number;
  /** Piso del avalúo en PESOS (no centavos): así se captura en el admin. */
  avaluoPisoMin: number;
  avaluoPisoMax: number;
  certificadosMin: number;
  certificadosMax: number;
  ivaHonorariosPct: number;
}

/** Un tramo de la tarifa anual del art. 152 LISR. */
export interface TarifaTramo {
  /** Límite inferior en PESOS. */
  li: number;
  /** Límite superior en PESOS. null = "en adelante". */
  ls: number | null;
  /** Cuota fija en PESOS. */
  cuota: number;
  /** Porcentaje sobre el excedente del límite inferior. */
  pct: number;
}

export interface IsrParams {
  year: number;
  udi: number;
  udiYear: number;
  udiFuente: string;
  exencionUdis: number;
  aniosExencionPrevia: number;
  tarifaAnual: TarifaTramo[];
  tarifaFuente: string;
  depreciacionAnualPct: number;
  proporcionTerrenoPct: number;
  pisoConstruccionPct: number;
  topeAnios: number;
  /** Cedular estatal sobre la ganancia. 0 en la mayoría de los estados. */
  cedularPct: number;
  stateCode: string;
  stateName: string;
  /** Índice de diciembre por año. Lo que hay; puede tener huecos. */
  inpcPorAnio: Record<number, number>;
}

export interface ProductoCreditoParams {
  montoMaximo: number;
  tasaAnualMin: number;
  tasaAnualMax: number;
  plazoMaximoMeses: number;
  edadMaximaFinal: number;
  factorCapacidadPago: number;
}

export interface CreditoParams {
  year: number;
  infonavit: ProductoCreditoParams & {
    unamosMontoMaximo: number;
    puntosMinimos: number;
  };
  fovissste: ProductoCreditoParams;
  bancario: ProductoCreditoParams & {
    tasaAnualReferencia: number;
    aforoMaximoPct: number;
  };
  fuentes: { infonavit: string; fovissste: string; bancario: string };
}

// ── Resolutor ──────────────────────────────────────────────────────────

function metaNum(meta: Record<string, unknown> | null, key: string): number | null {
  if (!meta) return null;
  const v = meta[key];
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function metaStr(meta: Record<string, unknown> | null, key: string, fallback = ""): string {
  if (!meta) return fallback;
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v : fallback;
}

function metaObj(
  meta: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (!meta) return null;
  const v = meta[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * La fila vigente para (kind, stateCode) en una fecha.
 *
 * Regla del contrato, literal: «se toma el de effectiveFrom más reciente
 * que sea <= la fecha de la operación; NUNCA se asume que hay uno solo por
 * año». Un congreso estatal puede mover el ISAI a media anualidad y las dos
 * filas conviven.
 */
export function pickVigente(
  rows: RawCalcParamRow[],
  kind: RealtyCalcParamKind,
  stateCode: string,
  at: Date,
): RawCalcParamRow | null {
  const limite = at.getTime();
  let mejor: RawCalcParamRow | null = null;
  let mejorTs = -Infinity;
  for (const row of rows) {
    if (row.kind !== kind || row.stateCode !== stateCode) continue;
    const ts = Date.parse(row.effectiveFrom);
    if (!Number.isFinite(ts) || ts > limite) continue;
    // Empate exacto de vigencia: gana el año mayor (una corrección posterior
    // del mismo valor se captura con el mismo effectiveFrom y año más alto).
    if (ts > mejorTs || (ts === mejorTs && mejor && row.year > mejor.year)) {
      mejor = row;
      mejorTs = ts;
    }
  }
  return mejor;
}

function faltante(
  kind: RealtyCalcParamKind,
  stateCode: string,
  etiqueta: string,
): CalcFaltante {
  return {
    kind,
    stateCode,
    etiqueta,
    comoResolver:
      "Captúralo en el panel de DaleControl, en Inmobiliarias → Parámetros de las calculadoras.",
  };
}

/**
 * Un parámetro fuera de rango es tan inútil como uno que falta, y más
 * peligroso: `topeAnios = 0` producía una división entre cero cuyo Infinity
 * viajaba hasta el desglose de la pantalla, y `tasaAnualMin = 0` regalaba un
 * crédito sin intereses. El editor de /admin acepta JSON crudo a propósito,
 * así que la cordura se comprueba AQUÍ, al leer.
 */
function enRango(v: number, min: number, max: number): boolean {
  return Number.isFinite(v) && v >= min && v <= max;
}

/** Aviso estándar cuando el parámetro vigente ya no es del año en curso. */
function avisoAnioViejo(etiqueta: string, year: number, anioActual: number): string | null {
  if (year >= anioActual) return null;
  return `${etiqueta}: el valor vigente es de ${year}. Si ya se publicó el de ${anioActual}, cárgalo en Parámetros para que el cálculo use el del año correcto.`;
}

export function resolveEscrituracionParams(
  rows: RawCalcParamRow[],
  stateCode: string,
  at: Date,
): ParamsResolved<EscrituracionParams> {
  const faltantes: CalcFaltante[] = [];
  const avisos: string[] = [];
  const anioActual = at.getFullYear();

  const base = pickVigente(rows, "ISAI", FEDERAL_STATE_CODE, at);
  const estado = pickVigente(rows, "ISAI", stateCode, at);

  if (!base) {
    faltantes.push(
      faltante(
        "ISAI",
        FEDERAL_STATE_CODE,
        "Costos base de escrituración (honorarios notariales, registro, avalúo, certificados e IVA)",
      ),
    );
  }
  if (!estado) {
    faltantes.push(faltante("ISAI", stateCode, `Tasa de ISAI de ${stateName(stateCode)}`));
  }
  if (!base || !estado) return { ok: false, faltantes, avisos };

  const meta = base.meta;
  const req = (key: string, etiqueta: string): number => {
    const n = metaNum(meta, key);
    if (n === null) {
      faltantes.push(faltante("ISAI", FEDERAL_STATE_CODE, etiqueta));
      return 0;
    }
    return n;
  };

  const params: EscrituracionParams = {
    year: estado.year,
    stateCode,
    stateName: stateName(stateCode),
    isaiPct: estado.value,
    isaiFuente: metaStr(estado.meta, "fuente", "Sin fuente capturada"),
    isaiPorVerificar: estado.meta?.porVerificar === true,
    isaiNota: metaStr(estado.meta, "nota"),
    notarioPctMin: req("notarioPctMin", "Honorarios notariales (mínimo)"),
    notarioPctMax: req("notarioPctMax", "Honorarios notariales (máximo)"),
    registroPctMin: req("registroPctMin", "Registro Público (mínimo)"),
    registroPctMax: req("registroPctMax", "Registro Público (máximo)"),
    avaluoPctMin: req("avaluoPctMin", "Avalúo (mínimo)"),
    avaluoPctMax: req("avaluoPctMax", "Avalúo (máximo)"),
    avaluoPisoMin: req("avaluoPisoMin", "Piso del avalúo (mínimo)"),
    avaluoPisoMax: req("avaluoPisoMax", "Piso del avalúo (máximo)"),
    certificadosMin: req("certificadosMin", "Certificados (mínimo)"),
    certificadosMax: req("certificadosMax", "Certificados (máximo)"),
    ivaHonorariosPct: req("ivaHonorariosPct", "IVA sobre honorarios"),
  };

  if (faltantes.length > 0) return { ok: false, faltantes, avisos };

  const viejo = avisoAnioViejo(`Tasa de ISAI de ${params.stateName}`, estado.year, anioActual);
  if (viejo) avisos.push(viejo);
  // La nota del estado se calculaba y se tiraba. Es justo donde vive el matiz
  // que más mueve el número: que el ISAI de CDMX y del Estado de México son
  // TARIFAS PROGRESIVAS y la tasa sembrada es su extremo alto, así que
  // sobreestima en los inmuebles baratos.
  if (params.isaiNota) avisos.push(params.isaiNota);
  if (params.isaiPorVerificar) {
    avisos.push(
      `La tasa de ISAI de ${params.stateName} está marcada como POR VERIFICAR. Confírmala con la ley de hacienda vigente antes de dar el número por bueno.`,
    );
  }

  return { ok: true, params, faltantes, avisos };
}

export function resolveIsrParams(
  rows: RawCalcParamRow[],
  stateCode: string,
  at: Date,
): ParamsResolved<IsrParams> {
  const faltantes: CalcFaltante[] = [];
  const avisos: string[] = [];
  const anioActual = at.getFullYear();

  const udi = pickVigente(rows, "UDI", FEDERAL_STATE_CODE, at);
  if (!udi) {
    faltantes.push(
      faltante("UDI", FEDERAL_STATE_CODE, "Valor de la UDI y parámetros del ISR"),
    );
    return { ok: false, faltantes, avisos };
  }

  const meta = udi.meta;
  const req = (key: string, etiqueta: string): number => {
    const n = metaNum(meta, key);
    if (n === null) {
      faltantes.push(faltante("UDI", FEDERAL_STATE_CODE, etiqueta));
      return 0;
    }
    return n;
  };

  const tarifaRaw = meta?.tarifaAnual;
  const tarifaAnual: TarifaTramo[] = [];
  if (Array.isArray(tarifaRaw)) {
    for (const t of tarifaRaw as Record<string, unknown>[]) {
      const li = Number(t?.li);
      const cuota = Number(t?.cuota);
      const pct = Number(t?.pct);
      const lsRaw = t?.ls;
      const ls = lsRaw === null || lsRaw === undefined ? null : Number(lsRaw);
      if (!Number.isFinite(li) || !Number.isFinite(cuota) || !Number.isFinite(pct)) continue;
      tarifaAnual.push({ li, ls: ls !== null && Number.isFinite(ls) ? ls : null, cuota, pct });
    }
  }
  if (tarifaAnual.length === 0) {
    faltantes.push(
      faltante("UDI", FEDERAL_STATE_CODE, "Tarifa anual del ISR (artículo 152 de la LISR)"),
    );
  }
  tarifaAnual.sort((a, b) => a.li - b.li);

  const inpcPorAnio: Record<number, number> = {};
  for (const row of rows) {
    if (row.kind !== "INPC") continue;
    const ts = Date.parse(row.effectiveFrom);
    if (!Number.isFinite(ts) || ts > at.getTime()) continue;
    if (row.value > 0) inpcPorAnio[row.year] = row.value;
  }
  if (Object.keys(inpcPorAnio).length === 0) {
    faltantes.push(
      faltante("INPC", FEDERAL_STATE_CODE, "INPC (el índice con el que se actualiza el costo)"),
    );
  }

  const estado = pickVigente(rows, "ISAI", stateCode, at);
  const cedularCapturado = estado ? metaNum(estado.meta, "cedularPct") : null;
  const cedularPct = cedularCapturado ?? 0;
  if (!estado) {
    avisos.push(
      `No tengo capturado ${stateName(stateCode)}, así que el cálculo no incluye impuesto cedular estatal. Si ese estado cobra cedular, el impuesto real será mayor.`,
    );
  } else if (cedularCapturado === null) {
    // Asumir 0 es lo razonable (28 de 32 estados no lo cobran), pero un cero
    // ASUMIDO no puede pasar por un cero SABIDO: en Chihuahua, Guanajuato,
    // Quintana Roo o Yucatán serían cinco puntos de la ganancia sin avisar.
    avisos.push(
      `${stateName(stateCode)} no tiene capturado su impuesto cedular, así que lo tomé como 0%. Si ese estado sí lo cobra, el impuesto real será mayor: captúralo en Parámetros.`,
    );
  }

  const params: IsrParams = {
    year: udi.year,
    udi: udi.value,
    udiYear: udi.year,
    udiFuente: metaStr(meta, "fuente", "Sin fuente capturada"),
    exencionUdis: req("exencionUdis", "Tope de la exención de casa habitación (en UDIS)"),
    aniosExencionPrevia: req("aniosExencionPrevia", "Años de espera entre exenciones"),
    tarifaAnual,
    tarifaFuente: metaStr(meta, "tarifaFuente", "Sin fuente capturada"),
    depreciacionAnualPct: req("depreciacionAnualPct", "Depreciación anual de la construcción"),
    proporcionTerrenoPct: req("proporcionTerrenoPct", "Proporción del terreno en el costo"),
    pisoConstruccionPct: req("pisoConstruccionPct", "Piso del costo de construcción"),
    topeAnios: req("topeAnios", "Tope de años para dividir la ganancia"),
    cedularPct,
    stateCode,
    stateName: stateName(stateCode),
    inpcPorAnio,
  };

  // Cordura de los que pueden reventar la aritmética si vienen mal.
  if (!enRango(params.udi, 0.01, 1000)) {
    faltantes.push(faltante("UDI", FEDERAL_STATE_CODE, "Valor de la UDI (fuera de un rango creíble)"));
  }
  if (!enRango(params.exencionUdis, 1, 10_000_000)) {
    faltantes.push(faltante("UDI", FEDERAL_STATE_CODE, "Tope de la exención (fuera de rango)"));
  }
  if (!enRango(params.topeAnios, 1, 100)) {
    faltantes.push(
      faltante("UDI", FEDERAL_STATE_CODE, "Tope de años para dividir la ganancia (tiene que ser 1 o más)"),
    );
  }
  if (!enRango(params.proporcionTerrenoPct, 0, 100)) {
    faltantes.push(faltante("UDI", FEDERAL_STATE_CODE, "Proporción del terreno (0 a 100)"));
  }
  if (!enRango(params.depreciacionAnualPct, 0, 100)) {
    faltantes.push(faltante("UDI", FEDERAL_STATE_CODE, "Depreciación anual (0 a 100)"));
  }
  if (!enRango(params.pisoConstruccionPct, 0, 100)) {
    faltantes.push(faltante("UDI", FEDERAL_STATE_CODE, "Piso del costo de construcción (0 a 100)"));
  }
  if (!enRango(params.cedularPct, 0, 100)) {
    faltantes.push(faltante("ISAI", stateCode, "Impuesto cedular del estado (0 a 100)"));
  }

  if (faltantes.length > 0) return { ok: false, faltantes, avisos };

  const viejo = avisoAnioViejo("Valor de la UDI", udi.year, anioActual);
  if (viejo) avisos.push(viejo);
  if (meta?.porVerificar === true) {
    avisos.push(
      "El valor de la UDI está marcado como POR VERIFICAR. El que manda es el del día de la operación, publicado por Banxico.",
    );
  }

  return { ok: true, params, faltantes, avisos };
}

function leerProducto(
  row: RawCalcParamRow,
  push: (etiqueta: string) => void,
  keys: { tasaMin: string; tasaMax: string; plazo: string; edad: string; factor: string },
  etiquetas: Record<string, string>,
  meta: Record<string, unknown> | null,
): ProductoCreditoParams {
  const num = (key: string, etiqueta: string): number => {
    const n = metaNum(meta, key);
    if (n === null) {
      push(etiqueta);
      return 0;
    }
    return n;
  };
  return {
    montoMaximo: row.value,
    tasaAnualMin: num(keys.tasaMin, etiquetas.tasaMin),
    tasaAnualMax: num(keys.tasaMax, etiquetas.tasaMax),
    plazoMaximoMeses: num(keys.plazo, etiquetas.plazo),
    edadMaximaFinal: num(keys.edad, etiquetas.edad),
    factorCapacidadPago: num(keys.factor, etiquetas.factor),
  };
}

export function resolveCreditoParams(
  rows: RawCalcParamRow[],
  at: Date,
): ParamsResolved<CreditoParams> {
  const faltantes: CalcFaltante[] = [];
  const avisos: string[] = [];
  const anioActual = at.getFullYear();

  const inf = pickVigente(rows, "INFONAVIT", FEDERAL_STATE_CODE, at);
  const fov = pickVigente(rows, "FOVISSSTE", FEDERAL_STATE_CODE, at);

  if (!inf) {
    faltantes.push(
      faltante("INFONAVIT", FEDERAL_STATE_CODE, "Topes y tasas de Infonavit (y del crédito bancario)"),
    );
  }
  if (!fov) {
    faltantes.push(faltante("FOVISSSTE", FEDERAL_STATE_CODE, "Topes y tasas de Fovissste"));
  }
  if (!inf || !fov) return { ok: false, faltantes, avisos };

  const pushInf = (etiqueta: string) =>
    faltantes.push(faltante("INFONAVIT", FEDERAL_STATE_CODE, etiqueta));
  const pushFov = (etiqueta: string) =>
    faltantes.push(faltante("FOVISSSTE", FEDERAL_STATE_CODE, etiqueta));

  const infBase = leerProducto(
    inf,
    pushInf,
    {
      tasaMin: "tasaAnualMin",
      tasaMax: "tasaAnualMax",
      plazo: "plazoMaximoMeses",
      edad: "edadMaximaFinal",
      factor: "factorCapacidadPago",
    },
    {
      tasaMin: "Tasa mínima de Infonavit",
      tasaMax: "Tasa máxima de Infonavit",
      plazo: "Plazo máximo de Infonavit",
      edad: "Edad máxima al terminar de pagar (Infonavit)",
      factor: "Porcentaje del sueldo que Infonavit descuenta",
    },
    inf.meta,
  );

  const fovBase = leerProducto(
    fov,
    pushFov,
    {
      tasaMin: "tasaAnualMin",
      tasaMax: "tasaAnualMax",
      plazo: "plazoMaximoMeses",
      edad: "edadMaximaFinal",
      factor: "factorCapacidadPago",
    },
    {
      tasaMin: "Tasa mínima de Fovissste",
      tasaMax: "Tasa máxima de Fovissste",
      plazo: "Plazo máximo de Fovissste",
      edad: "Edad máxima al terminar de pagar (Fovissste)",
      factor: "Porcentaje del sueldo que Fovissste descuenta",
    },
    fov.meta,
  );

  const bancoMeta = metaObj(inf.meta, "bancario");
  if (!bancoMeta) {
    faltantes.push(
      faltante("INFONAVIT", FEDERAL_STATE_CODE, "Parámetros del crédito bancario (tasa, plazo y aforo)"),
    );
  }
  const bancoNum = (key: string, etiqueta: string): number => {
    const n = metaNum(bancoMeta, key);
    if (n === null) {
      pushInf(etiqueta);
      return 0;
    }
    return n;
  };

  const unamos = metaNum(inf.meta, "unamosMontoMaximo");
  if (unamos === null) pushInf("Tope de Unamos Créditos");
  const puntos = metaNum(inf.meta, "puntosMinimos");
  if (puntos === null) pushInf("Puntos mínimos de Infonavit");

  const params: CreditoParams = {
    year: inf.year,
    infonavit: {
      ...infBase,
      unamosMontoMaximo: unamos ?? 0,
      puntosMinimos: puntos ?? 0,
    },
    fovissste: fovBase,
    bancario: {
      montoMaximo: bancoNum("montoMaximo", "Tope del crédito bancario"),
      tasaAnualMin: bancoNum("tasaAnualMin", "Tasa mínima del crédito bancario"),
      tasaAnualMax: bancoNum("tasaAnualMax", "Tasa máxima del crédito bancario"),
      tasaAnualReferencia: bancoNum("tasaAnualReferencia", "Tasa de referencia del crédito bancario"),
      plazoMaximoMeses: bancoNum("plazoMaximoMeses", "Plazo máximo del crédito bancario"),
      edadMaximaFinal: bancoNum("edadMaximaFinal", "Edad máxima al terminar de pagar (banco)"),
      factorCapacidadPago: bancoNum("factorCapacidadPago", "Porcentaje del ingreso que acepta el banco"),
      aforoMaximoPct: bancoNum("aforoMaximoPct", "Aforo máximo del banco"),
    },
    fuentes: {
      infonavit: metaStr(inf.meta, "fuente", "Sin fuente capturada"),
      fovissste: metaStr(fov.meta, "fuente", "Sin fuente capturada"),
      bancario: metaStr(bancoMeta, "fuente", "Sin fuente capturada"),
    },
  };

  // Cordura de los tres productos. Una tasa de 0% o un factor de pago de 3
  // no son "configuración agresiva": son un parámetro mal capturado que
  // regalaría crédito o descontaría el triple del sueldo.
  const productos: [string, ProductoCreditoParams, RealtyCalcParamKind][] = [
    ["Infonavit", params.infonavit, "INFONAVIT"],
    ["Fovissste", params.fovissste, "FOVISSSTE"],
    ["crédito bancario", params.bancario, "INFONAVIT"],
  ];
  for (const [nombre, p, kind] of productos) {
    if (!enRango(p.montoMaximo, 1, 1_000_000_000)) {
      faltantes.push(faltante(kind, FEDERAL_STATE_CODE, `Monto máximo de ${nombre} (fuera de rango)`));
    }
    if (!enRango(p.tasaAnualMin, 0.01, 100) || !enRango(p.tasaAnualMax, 0.01, 100)) {
      faltantes.push(faltante(kind, FEDERAL_STATE_CODE, `Tasas de ${nombre} (entre 0.01% y 100%)`));
    }
    if (!enRango(p.plazoMaximoMeses, 1, 600)) {
      faltantes.push(faltante(kind, FEDERAL_STATE_CODE, `Plazo máximo de ${nombre} (1 a 600 meses)`));
    }
    if (!enRango(p.edadMaximaFinal, 18, 120)) {
      faltantes.push(faltante(kind, FEDERAL_STATE_CODE, `Edad máxima de ${nombre} (18 a 120)`));
    }
    if (!enRango(p.factorCapacidadPago, 0.01, 1)) {
      faltantes.push(
        faltante(kind, FEDERAL_STATE_CODE, `Porcentaje del sueldo que descuenta ${nombre} (entre 0.01 y 1)`),
      );
    }
  }
  if (!enRango(params.bancario.aforoMaximoPct, 1, 100)) {
    faltantes.push(faltante("INFONAVIT", FEDERAL_STATE_CODE, "Aforo máximo del banco (1 a 100)"));
  }

  if (faltantes.length > 0) return { ok: false, faltantes, avisos };

  const v1 = avisoAnioViejo("Topes de Infonavit", inf.year, anioActual);
  if (v1) avisos.push(v1);
  const v2 = avisoAnioViejo("Topes de Fovissste", fov.year, anioActual);
  if (v2) avisos.push(v2);

  return { ok: true, params, faltantes, avisos };
}

// ── Saneado del `meta` antes de que salga del servidor ─────────────────
//
// 🔴 El `meta` se edita como JSON CRUDO en /admin (tiene que serlo: ahí viven
// los once tramos de la tarifa del 152). Y estas filas se sirven a internet
// sin sesión, cacheadas media hora en el borde, porque son tasas de impuestos
// públicas.
//
// Las dos cosas juntas son el problema: cualquier cosa que alguien pegue por
// error en ese JSON —una nota interna, el dato de un proveedor, una llave— se
// publicaría sola. Por eso lo que sale lleva LISTA BLANCA: solo las llaves que
// los resolutores de arriba leen de verdad. Una llave nueva en el catálogo hay
// que darla de alta aquí, y ese trabajo extra es exactamente la garantía.

const META_COMUN = ["etiqueta", "descripcion", "nota", "fuente", "porVerificar"];

const META_BANCARIO = [
  ...META_COMUN,
  "montoMaximo",
  "tasaAnualMin",
  "tasaAnualMax",
  "tasaAnualReferencia",
  "plazoMaximoMeses",
  "edadMaximaFinal",
  "factorCapacidadPago",
  "aforoMaximoPct",
];

const META_PERMITIDO: Record<RealtyCalcParamKind, string[]> = {
  ISAI: [
    ...META_COMUN,
    "cedularPct",
    "notarioPctMin",
    "notarioPctMax",
    "registroPctMin",
    "registroPctMax",
    "avaluoPctMin",
    "avaluoPctMax",
    "avaluoPisoMin",
    "avaluoPisoMax",
    "certificadosMin",
    "certificadosMax",
    "ivaHonorariosPct",
  ],
  UMA: [...META_COMUN, "mensual", "anual"],
  UDI: [
    ...META_COMUN,
    "exencionUdis",
    "aniosExencionPrevia",
    "depreciacionAnualPct",
    "proporcionTerrenoPct",
    "pisoConstruccionPct",
    "topeAnios",
    "tarifaAnual",
    "tarifaFuente",
  ],
  INPC: [...META_COMUN, "mes", "base", "confianza"],
  INFONAVIT: [
    ...META_COMUN,
    "unamosMontoMaximo",
    "tasaAnualMin",
    "tasaAnualMax",
    "plazoMaximoMeses",
    "puntosMinimos",
    "edadMaximaFinal",
    "factorCapacidadPago",
    "bancario",
  ],
  FOVISSSTE: [
    ...META_COMUN,
    "tasaAnualMin",
    "tasaAnualMax",
    "plazoMaximoMeses",
    "edadMaximaFinal",
    "factorCapacidadPago",
  ],
};

function filtrar(meta: Record<string, unknown>, permitidas: string[]): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const k of permitidas) {
    if (Object.prototype.hasOwnProperty.call(meta, k)) salida[k] = meta[k];
  }
  return salida;
}

/** Deja en el `meta` SOLO lo que las calculadoras leen. */
export function sanitizarMeta(
  kind: RealtyCalcParamKind,
  meta: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!meta) return null;
  const permitidas = META_PERMITIDO[kind];
  if (!permitidas) return null;
  const salida = filtrar(meta, permitidas);
  const banc = salida.bancario;
  if (banc && typeof banc === "object" && !Array.isArray(banc)) {
    salida.bancario = filtrar(banc as Record<string, unknown>, META_BANCARIO);
  }
  return salida;
}

/**
 * La leyenda que acompaña a TODO resultado, sin excepción.
 *
 * 🔴 Esto no es asesoría fiscal ni financiera y ningún número que salga de
 * aquí es definitivo. Va pegada al resultado —dentro del objeto, no en la
 * UI— justamente para que no se pueda pintar un número sin ella: quien
 * dibuje una pantalla nueva se encuentra el campo ya lleno.
 */
export function leyendaEstimado(year: number, confirmarCon: string): string {
  return `Cálculo estimado con los valores vigentes de ${year}; confirma con tu ${confirmarCon}. Esto no es asesoría fiscal ni financiera.`;
}

/**
 * Los `kind` que el año en curso debería tener cargados. Alimenta la alerta
 * de "revisar cada enero" del panel de administración.
 */
export const KINDS_ANUALES: RealtyCalcParamKind[] = [
  "ISAI",
  "UMA",
  "UDI",
  "INFONAVIT",
  "FOVISSSTE",
];

/** Qué familias de parámetros NO tienen ninguna fila del año dado. */
export function kindsSinAnio(rows: RawCalcParamRow[], year: number): RealtyCalcParamKind[] {
  const conAnio = new Set(rows.filter((r) => r.year === year).map((r) => r.kind));
  return KINDS_ANUALES.filter((k) => !conAnio.has(k));
}
