// Ortodoncia — Parte 7 (ws1-t8, sep-2026). H1/H4: comparación de las 5
// medidas contra valores de referencia. Puro — sin Prisma, sin React.
//
// Los valores "clásicos" de abajo son los que enseña la literatura
// ortodóntica de uso extendido (Steiner 1953; análisis de Tweed/Ricketts
// para FMA; McNamara comparte SNA/SNB/ANB como medidas cruzadas aunque su
// análisis original usa Wits y longitudes efectivas, que este trazado
// manual todavía no calcula — ver `docs` en cada entrada). Son valores de
// enseñanza, no una cita a un paper específico: el doctor los contrasta con
// su propio texto de referencia antes de decidir tratamiento.
//
// Los valores MEXICANOS sí tienen fuente puntual: alcance-ortodoncia.html
// (bloque H, hallazgo 1) cita que en población mexicana el ANB normal ronda
// 3° (no 2°) y la inclinación del incisivo inferior (IMPA) ronda 95° (no
// 90°). Para SNA/SNB/FMA no hay dato mexicano citado en esa investigación:
// se deja `null` en vez de inventar un número.

import type { CephMeasurements } from "./measurements";

export type CephAnalysisType = "STEINER" | "RICKETTS" | "MCNAMARA";
export type CephNormSet = "STANDARD" | "MEXICAN";

export const CEPH_ANALYSIS_LABELS: Record<CephAnalysisType, string> = {
  STEINER: "Steiner",
  RICKETTS: "Ricketts",
  MCNAMARA: "McNamara",
};

export interface NormRange {
  mean: number;
  sd: number;
}

export type MeasurementKey = keyof CephMeasurements;

export type NormTable = Partial<Record<MeasurementKey, NormRange | null>>;

const CLASSIC_NORMS: NormTable = {
  SNA: { mean: 82, sd: 2 },
  SNB: { mean: 80, sd: 2 },
  ANB: { mean: 2, sd: 2 },
  FMA: { mean: 25, sd: 3 },
  IMPA: { mean: 90, sd: 4 },
};

const MEXICAN_OVERRIDES: NormTable = {
  ANB: { mean: 3, sd: 2 },
  IMPA: { mean: 95, sd: 4 },
  // SNA/SNB/FMA: sin dato citado para población mexicana — se conserva null
  // en vez de asumir que la referencia clásica aplica igual.
  SNA: null,
  SNB: null,
  FMA: null,
};

/**
 * Nota de alcance por análisis: qué NO calcula todavía este trazado manual,
 * para no dar a entender que "Ricketts" o "McNamara" están completos.
 */
export const CEPH_ANALYSIS_SCOPE_NOTE: Record<CephAnalysisType, string> = {
  STEINER: "Steiner completo para estas 5 medidas.",
  RICKETTS: "Comparte SNA/SNB/ANB/FMA/IMPA como referencia cruzada; el análisis de Ricketts original agrega ángulo facial, profundidad facial y convexidad, que este trazado no calcula todavía (ver H2/H6, integración con WebCeph/CephX).",
  MCNAMARA: "Comparte SNA/SNB/ANB/FMA/IMPA como referencia cruzada; el análisis de McNamara original usa el análisis de Wits y longitudes efectivas maxilar/mandibular, que este trazado no calcula todavía.",
};

export function getNormTable(analysisType: CephAnalysisType, normSet: CephNormSet): NormTable {
  if (normSet === "STANDARD") return CLASSIC_NORMS;
  // MEXICAN: parte de la tabla clásica y sobreescribe solo lo que tiene dato citado.
  return { ...CLASSIC_NORMS, ...MEXICAN_OVERRIDES };
}

export type NormInterpretation = "normal" | "aumentado" | "disminuido" | "sin-norma" | "sin-medida";

export interface NormEvaluation {
  key: MeasurementKey;
  value: number | null;
  norm: NormRange | null;
  deviationSd: number | null;
  interpretation: NormInterpretation;
}

const KEYS: MeasurementKey[] = ["SNA", "SNB", "ANB", "FMA", "IMPA"];

export function evaluateAgainstNorms(
  measurements: CephMeasurements,
  analysisType: CephAnalysisType,
  normSet: CephNormSet,
): NormEvaluation[] {
  const table = getNormTable(analysisType, normSet);
  return KEYS.map((key) => {
    const value = measurements[key];
    const norm = table[key] ?? null;
    if (value === null) {
      return { key, value, norm, deviationSd: null, interpretation: "sin-medida" as const };
    }
    if (!norm) {
      return { key, value, norm: null, deviationSd: null, interpretation: "sin-norma" as const };
    }
    const deviationSd = norm.sd > 0 ? round1((value - norm.mean) / norm.sd) : 0;
    const interpretation: NormInterpretation =
      Math.abs(value - norm.mean) <= norm.sd
        ? "normal"
        : value > norm.mean
          ? "aumentado"
          : "disminuido";
    return { key, value, norm, deviationSd, interpretation };
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
