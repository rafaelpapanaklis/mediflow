// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · calculadoras — SEMILLA DE PARÁMETROS.
//
// Módulo PURO (lo lee el panel de administración para pintar la vista previa
// de lo que va a sembrar, y la acción de servidor para escribirlo).
//
// 🔴 ESTO NO ES LA FUENTE DE VERDAD. Las calculadoras leen SIEMPRE la tabla
// realty_calc_params. Esto es el punto de partida que el administrador
// escribe una vez, revisa y corrige. Por eso cada fila lleva:
//
//   fuente        — de dónde salió el número, en una línea.
//   porVerificar  — true si NADIE lo confirmó todavía contra el documento
//                   oficial. La pantalla de parámetros lo pinta en ámbar y
//                   la calculadora lo dice en su aviso.
//
// La tabla nace VACÍA a propósito (decisión de la Ola 0: «sembrar números
// sin verificar produce una calculadora peor que no tenerla»). Sembrar es un
// acto explícito del administrador, no un efecto secundario del despliegue,
// y todo lo sembrado sale marcado hasta que alguien lo audite.
//
// ⚠️ REVISAR CADA ENERO. La UMA la publica el INEGI en enero, el ISAI lo
// fija cada congreso estatal en su ley de ingresos, y la tarifa del ISR la
// actualiza el SAT en el Anexo 8 de la RMF.
// ═══════════════════════════════════════════════════════════════════════
import type { RealtyCalcParamKind } from "@/lib/realty/types";
import { FEDERAL_STATE_CODE, MX_STATES, type TarifaTramo } from "./catalog";

export interface SeedRow {
  kind: RealtyCalcParamKind;
  stateCode: string;
  year: number;
  value: number;
  meta: Record<string, unknown>;
  /** ISO date (YYYY-MM-DD). */
  effectiveFrom: string;
}

/** El año fiscal que siembra esta versión del catálogo. */
export const SEED_YEAR = 2026;

/**
 * Tarifa ANUAL del artículo 152 de la LISR (Anexo 8 de la RMF).
 *
 * ✅ VERIFICADA ARITMÉTICAMENTE, tramo por tramo: la cuota fija de cada
 * renglón es exactamente la cuota del anterior más el excedente del tramo
 * anterior por su tasa. Que los once renglones encadenen sin un peso de
 * diferencia es la firma de una tarifa real; una inventada no encaja.
 * Las pruebas `aritmetica.test.ts` reejecutan esa comprobación tramo a tramo.
 *
 * ⚠️ Es la tarifa vigente desde 2024. El SAT la actualiza cuando la
 * inflación acumulada rebasa el 10%. Al empezar cada año hay que comparar
 * contra el Anexo 8 publicado y, si cambió, capturar la nueva con su propio
 * effectiveFrom — la vieja se queda para poder recalcular operaciones de
 * años anteriores.
 */
export const TARIFA_ISR_ANUAL_2024: TarifaTramo[] = [
  { li: 0.01, ls: 8952.49, cuota: 0.0, pct: 1.92 },
  { li: 8952.5, ls: 75984.55, cuota: 171.88, pct: 6.4 },
  { li: 75984.56, ls: 133536.07, cuota: 4461.94, pct: 10.88 },
  { li: 133536.08, ls: 155229.8, cuota: 10723.55, pct: 16.0 },
  { li: 155229.81, ls: 185852.57, cuota: 14194.54, pct: 17.92 },
  { li: 185852.58, ls: 374837.88, cuota: 19682.13, pct: 21.36 },
  { li: 374837.89, ls: 590795.99, cuota: 60049.4, pct: 23.52 },
  { li: 590796.0, ls: 1127926.84, cuota: 110842.74, pct: 30.0 },
  { li: 1127926.85, ls: 1503902.46, cuota: 271981.99, pct: 32.0 },
  { li: 1503902.47, ls: 4511707.37, cuota: 392294.17, pct: 34.0 },
  { li: 4511707.38, ls: null, cuota: 1414947.85, pct: 35.0 },
];

/**
 * INPC de DICIEMBRE, base segunda quincena de julio de 2018 = 100.
 *
 * Los años 2015-2024 están encadenados y cuadran con la inflación anual
 * publicada de cada ejercicio (cada valor por (1 + inflación del año
 * siguiente) da el siguiente). 2010-2014 salen de la misma cadena hacia
 * atrás y por eso van con menos confianza.
 *
 * 🔴 NO se siembra 2025 ni 2026: no los tengo verificados y un INPC
 * inventado corrompe la actualización del costo de adquisición, que es la
 * mitad del cálculo del ISR. Sin él, la calculadora usa el índice más
 * reciente que SÍ tenga y lo dice en pantalla.
 */
export const INPC_DICIEMBRE: { year: number; value: number; confianza: "alta" | "media" }[] = [
  { year: 2010, value: 74.93, confianza: "media" },
  { year: 2011, value: 77.792, confianza: "media" },
  { year: 2012, value: 80.568, confianza: "media" },
  { year: 2013, value: 83.77, confianza: "media" },
  { year: 2014, value: 87.189, confianza: "media" },
  { year: 2015, value: 89.047, confianza: "alta" },
  { year: 2016, value: 92.039, confianza: "alta" },
  { year: 2017, value: 98.273, confianza: "alta" },
  { year: 2018, value: 103.02, confianza: "alta" },
  { year: 2019, value: 105.934, confianza: "alta" },
  { year: 2020, value: 109.271, confianza: "alta" },
  { year: 2021, value: 117.308, confianza: "alta" },
  { year: 2022, value: 126.478, confianza: "alta" },
  { year: 2023, value: 132.373, confianza: "alta" },
  { year: 2024, value: 137.949, confianza: "alta" },
];

/**
 * ISAI por estado, en por ciento sobre la base gravable.
 *
 * `cedular` es el impuesto cedular estatal sobre la ganancia por enajenación
 * de inmuebles (lo permite el artículo 43 de la Ley del IVA, hasta 5%). Es
 * ADICIONAL al ISR federal, no acreditable contra él.
 *
 * ⚠️ LAS 32 FILAS NACEN MARCADAS «POR VERIFICAR», sin excepción — incluidas
 * las tres que vienen del brief del producto. El ISAI lo fija cada congreso
 * estatal y en varios estados lo recauda el municipio con su propia tarifa,
 * a veces progresiva. Estos números sirven para que la calculadora arranque
 * y para que se vea la forma del resultado; el número bueno lo confirma
 * quien lo audite contra la ley de ingresos vigente.
 */
const ISAI_POR_ESTADO: { code: string; pct: number; cedular: number; nota: string }[] = [
  { code: "AGU", pct: 2.0, cedular: 0, nota: "Referida en el brief como la tasa más baja del país." },
  { code: "BCN", pct: 2.0, cedular: 0, nota: "" },
  { code: "BCS", pct: 2.3, cedular: 0, nota: "" },
  { code: "CAM", pct: 2.0, cedular: 0, nota: "" },
  { code: "CHP", pct: 2.0, cedular: 0, nota: "" },
  { code: "CHH", pct: 2.0, cedular: 5, nota: "Cobra impuesto cedular sobre la ganancia." },
  {
    code: "CMX",
    pct: 4.97,
    cedular: 0,
    nota:
      "El Código Fiscal capitalino usa TARIFA PROGRESIVA: 4.97% es el extremo alto. En un inmueble barato la tasa efectiva es menor, así que este número tiende a sobreestimar.",
  },
  { code: "COA", pct: 3.0, cedular: 0, nota: "" },
  { code: "COL", pct: 2.0, cedular: 0, nota: "" },
  { code: "DUR", pct: 2.5, cedular: 0, nota: "" },
  { code: "GUA", pct: 2.0, cedular: 5, nota: "Cobra impuesto cedular sobre la ganancia." },
  { code: "GRO", pct: 2.0, cedular: 0, nota: "" },
  { code: "HID", pct: 2.0, cedular: 0, nota: "" },
  { code: "JAL", pct: 2.0, cedular: 0, nota: "Lo recauda el municipio; Guadalajara y Zapopan difieren." },
  { code: "MEX", pct: 4.5, cedular: 0, nota: "El Código Financiero usa tarifa progresiva por rangos." },
  { code: "MIC", pct: 2.0, cedular: 0, nota: "" },
  { code: "MOR", pct: 2.0, cedular: 0, nota: "" },
  { code: "NAY", pct: 2.0, cedular: 0, nota: "" },
  { code: "NLE", pct: 2.0, cedular: 0, nota: "Aplica sobre el excedente de una porción exenta." },
  { code: "OAX", pct: 2.0, cedular: 0, nota: "" },
  { code: "PUE", pct: 2.0, cedular: 0, nota: "" },
  { code: "QUE", pct: 2.0, cedular: 0, nota: "" },
  { code: "ROO", pct: 3.0, cedular: 5, nota: "Cobra impuesto cedular sobre la ganancia." },
  { code: "SLP", pct: 2.0, cedular: 0, nota: "" },
  { code: "SIN", pct: 2.0, cedular: 0, nota: "" },
  { code: "SON", pct: 2.0, cedular: 0, nota: "" },
  { code: "TAB", pct: 2.0, cedular: 0, nota: "" },
  { code: "TAM", pct: 2.0, cedular: 0, nota: "" },
  { code: "TLA", pct: 2.0, cedular: 0, nota: "" },
  { code: "VER", pct: 2.0, cedular: 0, nota: "" },
  { code: "YUC", pct: 2.0, cedular: 5, nota: "Cobra impuesto cedular y es de las tasas más bajas de ISAI." },
  { code: "ZAC", pct: 2.0, cedular: 0, nota: "" },
];

const FUENTE_ISAI =
  "Tasa general de referencia del brief del vertical. PENDIENTE de confirmar contra la ley de ingresos estatal o municipal vigente.";

/**
 * La semilla completa. Se ordena para que el panel la pinte agrupada.
 *
 * `effectiveFrom`:
 *   · ISAI, UDI, Infonavit y Fovissste → 1 de enero del año.
 *   · UMA → 1 de FEBRERO: la UMA entra en vigor ese día, no el 1 de enero.
 *   · INPC → 31 de diciembre del año al que pertenece el índice.
 */
export function buildSeed(): SeedRow[] {
  const rows: SeedRow[] = [];
  const eneroDelAnio = `${SEED_YEAR}-01-01`;

  // ── Costos base de escrituración (federal) ───────────────────────────
  rows.push({
    kind: "ISAI",
    stateCode: FEDERAL_STATE_CODE,
    year: SEED_YEAR,
    value: 2.0,
    effectiveFrom: eneroDelAnio,
    meta: {
      etiqueta: "Costos base de escrituración",
      descripcion:
        "Lo que se cobra ADEMÁS del ISAI y que es parecido en todo el país. Cada concepto es un rango porque depende de la notaría.",
      notarioPctMin: 1.0,
      notarioPctMax: 2.5,
      registroPctMin: 0.5,
      registroPctMax: 1.2,
      avaluoPctMin: 0.15,
      avaluoPctMax: 0.35,
      avaluoPisoMin: 3000,
      avaluoPisoMax: 5000,
      certificadosMin: 1500,
      certificadosMax: 6000,
      ivaHonorariosPct: 16,
      nota:
        "El IVA se aplica SOLO a los honorarios (notario y avalúo), que son servicios. El ISAI y los derechos del registro no lo causan. El valor de esta fila (2%) es la tasa de ISAI más común del país y aquí solo sirve de referencia: la que se usa en el cálculo es la del estado.",
      fuente: "Rangos de mercado del brief del vertical. IVA: 16% de la Ley del IVA.",
      porVerificar: true,
    },
  });

  // ── ISAI por estado ──────────────────────────────────────────────────
  for (const estado of ISAI_POR_ESTADO) {
    const nombre = MX_STATES.find((s) => s.code === estado.code)?.name ?? estado.code;
    rows.push({
      kind: "ISAI",
      stateCode: estado.code,
      year: SEED_YEAR,
      value: estado.pct,
      effectiveFrom: eneroDelAnio,
      meta: {
        etiqueta: `ISAI de ${nombre}`,
        cedularPct: estado.cedular,
        nota: estado.nota,
        fuente: FUENTE_ISAI,
        porVerificar: true,
      },
    });
  }

  // ── UMA ──────────────────────────────────────────────────────────────
  // Se siembra la de 2025 porque es la que tengo confirmada. La de 2026 la
  // captura quien la lea del DOF: la alerta del panel la va a pedir sola, y
  // eso es exactamente lo que el mecanismo tiene que hacer.
  rows.push({
    kind: "UMA",
    stateCode: FEDERAL_STATE_CODE,
    year: 2025,
    value: 113.14,
    effectiveFrom: "2025-02-01",
    meta: {
      etiqueta: "UMA (Unidad de Medida y Actualización)",
      mensual: 3439.46,
      anual: 41273.52,
      nota:
        "Vigente del 1 de febrero de 2025 al 31 de enero de 2026. El INEGI publica la nueva en enero y entra en vigor el 1 de febrero.",
      fuente: "INEGI, publicada en el Diario Oficial de la Federación.",
      porVerificar: false,
    },
  });

  // ── UDI + todo el bloque del ISR ─────────────────────────────────────
  rows.push({
    kind: "UDI",
    stateCode: FEDERAL_STATE_CODE,
    year: SEED_YEAR,
    value: 8.83,
    effectiveFrom: eneroDelAnio,
    meta: {
      etiqueta: "UDI y parámetros del ISR por venta",
      exencionUdis: 700000,
      aniosExencionPrevia: 3,
      depreciacionAnualPct: 3,
      proporcionTerrenoPct: 20,
      pisoConstruccionPct: 20,
      topeAnios: 20,
      tarifaAnual: TARIFA_ISR_ANUAL_2024,
      tarifaFuente:
        "Tarifa anual del artículo 152 de la LISR, Anexo 8 de la RMF, vigente desde 2024. Revisar cada enero por si el SAT publicó una nueva.",
      nota:
        "700,000 UDIS es el tope de la exención de casa habitación del artículo 93, fracción XIX. Con la UDI en 8.83 son unos 6.18 millones de pesos de PRECIO DE VENTA. La UDI que manda es la del día de la operación (Banxico); esta es de referencia.",
      fuente: "Valor de referencia de la UDI (Banxico). Los demás parámetros son de la LISR.",
      porVerificar: true,
    },
  });

  // ── INPC ─────────────────────────────────────────────────────────────
  for (const inpc of INPC_DICIEMBRE) {
    rows.push({
      kind: "INPC",
      stateCode: FEDERAL_STATE_CODE,
      year: inpc.year,
      value: inpc.value,
      effectiveFrom: `${inpc.year}-12-31`,
      meta: {
        etiqueta: `INPC de diciembre de ${inpc.year}`,
        mes: 12,
        base: "segunda quincena de julio de 2018 = 100",
        confianza: inpc.confianza,
        fuente:
          inpc.confianza === "alta"
            ? "INEGI, INPC de diciembre. Encadenado y cuadrado con la inflación anual publicada."
            : "INEGI, INPC de diciembre. Reconstruido desde la cadena de inflación anual: confírmalo antes de usarlo en una operación real.",
        porVerificar: inpc.confianza !== "alta",
      },
    });
  }

  // ── Infonavit (+ el bloque bancario, que no tiene kind propio) ───────
  rows.push({
    kind: "INFONAVIT",
    stateCode: FEDERAL_STATE_CODE,
    year: SEED_YEAR,
    value: 2935000,
    effectiveFrom: eneroDelAnio,
    meta: {
      etiqueta: "Infonavit y crédito bancario",
      unamosMontoMaximo: 5870000,
      tasaAnualMin: 3.76,
      tasaAnualMax: 10.45,
      plazoMaximoMeses: 360,
      puntosMinimos: 1080,
      edadMaximaFinal: 70,
      factorCapacidadPago: 0.3,
      nota:
        "El monto máximo del crédito tradicional es para UN trabajador. Unamos Créditos suma a dos y por eso su tope es el doble. Los puntos mínimos son la puerta de entrada: sin ellos no hay crédito, por mucho que alcance el sueldo.",
      fuente: "Cifras de Infonavit 2026 del brief del vertical.",
      porVerificar: true,
      bancario: {
        etiqueta: "Crédito bancario",
        montoMaximo: 30000000,
        tasaAnualMin: 10.0,
        tasaAnualReferencia: 11.5,
        tasaAnualMax: 13.0,
        plazoMaximoMeses: 240,
        edadMaximaFinal: 75,
        factorCapacidadPago: 0.35,
        aforoMaximoPct: 90,
        nota:
          "El banco presta hasta el aforo sobre el valor del inmueble, así que el enganche manda tanto como el sueldo. La tasa varía muchísimo por banco y por perfil: si el prospecto ya tiene una cotización, captura ESA tasa en la calculadora.",
        fuente: "Rangos de mercado. PENDIENTE de confirmar contra cotizaciones reales.",
        porVerificar: true,
      },
    },
  });

  // ── Fovissste ────────────────────────────────────────────────────────
  rows.push({
    kind: "FOVISSSTE",
    stateCode: FEDERAL_STATE_CODE,
    year: SEED_YEAR,
    value: 1420000,
    effectiveFrom: eneroDelAnio,
    meta: {
      etiqueta: "Fovissste",
      tasaAnualMin: 4.0,
      tasaAnualMax: 6.0,
      plazoMaximoMeses: 240,
      edadMaximaFinal: 70,
      factorCapacidadPago: 0.3,
      nota: "Para trabajadores al servicio del Estado. Tasa fija, más baja que la de un banco.",
      fuente: "Cifras de Fovissste 2026 del brief del vertical.",
      porVerificar: true,
    },
  });

  return rows;
}

/** Cuántas filas siembra el catálogo, para pintarlo antes de confirmar. */
export function seedResumen(): { total: number; porKind: Record<string, number>; porVerificar: number } {
  const rows = buildSeed();
  const porKind: Record<string, number> = {};
  let porVerificar = 0;
  for (const r of rows) {
    porKind[r.kind] = (porKind[r.kind] ?? 0) + 1;
    if (r.meta.porVerificar === true) porVerificar += 1;
  }
  return { total: rows.length, porKind, porVerificar };
}
