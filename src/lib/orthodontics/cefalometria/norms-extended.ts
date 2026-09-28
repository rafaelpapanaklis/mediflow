// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Normas de
// referencia para las medidas nuevas (Steiner extra, Ricketts, McNamara,
// Downs/Tweed). `../norms.ts` (H1 básico: SNA/SNB/ANB/FMA/IMPA) se queda
// TAL CUAL — este archivo es un módulo nuevo y separado, no una versión
// que lo reemplace, para no arriesgar el comportamiento ya probado que
// usa la pantalla de H1 básico (`CephalometriaPanel.tsx`, ws1-t4).
//
// Mismo criterio de cita que ya fijó `../norms.ts`: valores "clásicos" son
// de enseñanza ampliamente repetida (Steiner 1953; Ricketts 1961; Tweed
// 1954), no una cita a un paper puntual — el doctor los contrasta con su
// propio texto antes de decidir tratamiento. Donde la literatura hace el
// valor depender fuerte de EDAD/SEXO (McNamara) o de puntos que este
// trazado todavía no construye (Ricketts Xi-Pm), se deja `null` — nunca
// se inventa un número. Sin dato mexicano citado para ninguna de estas
// medidas nuevas (a diferencia de ANB/IMPA, que sí lo tienen — ver
// `../norms.ts`): MEXICAN aquí solo hereda esos 2 y dejas el resto igual
// que STANDARD.

import type { FullCephMeasurements } from "./full-analysis";
import type { CephNormSet, NormInterpretation, NormRange } from "./norms";

export type { NormInterpretation };

export type FullMeasurementKey = keyof FullCephMeasurements;
export type FullNormTable = Partial<Record<FullMeasurementKey, NormRange | null>>;

export type FullCephAnalysisType = "STEINER" | "RICKETTS" | "MCNAMARA" | "DOWNS_TWEED";

export const FULL_CEPH_ANALYSIS_LABELS: Record<FullCephAnalysisType, string> = {
  STEINER: "Steiner",
  RICKETTS: "Ricketts",
  MCNAMARA: "McNamara",
  DOWNS_TWEED: "Downs / Tweed",
};

/** Qué medidas muestra cada análisis, en el orden en que se reportan (PDF y UI). */
export const ANALYSIS_MEASUREMENT_KEYS: Record<FullCephAnalysisType, FullMeasurementKey[]> = {
  STEINER: ["SNA", "SNB", "ANB", "SN_GOGN", "U1_NA_DEG", "U1_NA_MM", "L1_NB_DEG", "L1_NB_MM", "INTERINCISAL", "OCCLUSAL_SN"],
  RICKETTS: ["FACIAL_AXIS", "FACIAL_DEPTH", "MANDIBULAR_PLANE_RICKETTS", "CONVEXITY_MM", "UPPER_LIP_E_MM", "LOWER_LIP_E_MM"],
  MCNAMARA: ["A_TO_NPERP_MM", "PG_TO_NPERP_MM", "CO_A_MM", "CO_GN_MM", "MAXMAND_DIFFERENTIAL_MM", "LOWER_FACE_HEIGHT_MM"],
  DOWNS_TWEED: ["FMA", "FMIA", "IMPA"],
};

export type MeasurementUnit = "deg" | "mm";

export const MEASUREMENT_UNIT: Record<FullMeasurementKey, MeasurementUnit> = {
  SNA: "deg",
  SNB: "deg",
  ANB: "deg",
  FMA: "deg",
  IMPA: "deg",
  SN_GOGN: "deg",
  U1_NA_DEG: "deg",
  U1_NA_MM: "mm",
  L1_NB_DEG: "deg",
  L1_NB_MM: "mm",
  INTERINCISAL: "deg",
  OCCLUSAL_SN: "deg",
  FACIAL_AXIS: "deg",
  FACIAL_DEPTH: "deg",
  MANDIBULAR_PLANE_RICKETTS: "deg",
  CONVEXITY_MM: "mm",
  UPPER_LIP_E_MM: "mm",
  LOWER_LIP_E_MM: "mm",
  A_TO_NPERP_MM: "mm",
  PG_TO_NPERP_MM: "mm",
  CO_A_MM: "mm",
  CO_GN_MM: "mm",
  MAXMAND_DIFFERENTIAL_MM: "mm",
  LOWER_FACE_HEIGHT_MM: "mm",
  FMIA: "deg",
};

export const MEASUREMENT_LABELS: Record<FullMeasurementKey, string> = {
  SNA: "SNA",
  SNB: "SNB",
  ANB: "ANB",
  FMA: "FMA",
  IMPA: "IMPA",
  SN_GOGN: "SN-GoGn",
  U1_NA_DEG: "1 a NA (°)",
  U1_NA_MM: "1 a NA (mm)",
  L1_NB_DEG: "1 a NB (°)",
  L1_NB_MM: "1 a NB (mm)",
  INTERINCISAL: "Ángulo interincisal",
  OCCLUSAL_SN: "Plano oclusal a SN",
  FACIAL_AXIS: "Eje facial",
  FACIAL_DEPTH: "Profundidad facial",
  MANDIBULAR_PLANE_RICKETTS: "Plano mandibular (Go-Gn a FH)",
  CONVEXITY_MM: "Convexidad (A a N-Pog)",
  UPPER_LIP_E_MM: "Labio superior a línea E",
  LOWER_LIP_E_MM: "Labio inferior a línea E",
  A_TO_NPERP_MM: "A a N-perpendicular",
  PG_TO_NPERP_MM: "Pog a N-perpendicular",
  CO_A_MM: "Co-A (long. efectiva maxilar)",
  CO_GN_MM: "Co-Gn (long. efectiva mandibular)",
  MAXMAND_DIFFERENTIAL_MM: "Diferencial maxilomandibular",
  LOWER_FACE_HEIGHT_MM: "Altura facial anteroinferior (ANS-Me)",
  FMIA: "FMIA",
};

const STEINER_CLASSIC: FullNormTable = {
  SNA: { mean: 82, sd: 2 },
  SNB: { mean: 80, sd: 2 },
  ANB: { mean: 2, sd: 2 },
  SN_GOGN: { mean: 32, sd: 5 },
  U1_NA_DEG: { mean: 22, sd: 4 },
  U1_NA_MM: { mean: 4, sd: 2 },
  L1_NB_DEG: { mean: 25, sd: 4 },
  L1_NB_MM: { mean: 4, sd: 2 },
  INTERINCISAL: { mean: 131, sd: 6 },
  OCCLUSAL_SN: { mean: 14, sd: 3 },
};

const RICKETTS_CLASSIC: FullNormTable = {
  FACIAL_AXIS: { mean: 90, sd: 3 },
  FACIAL_DEPTH: { mean: 87, sd: 3 },
  MANDIBULAR_PLANE_RICKETTS: { mean: 26, sd: 4 },
  CONVEXITY_MM: { mean: 2, sd: 2 },
  UPPER_LIP_E_MM: { mean: -4, sd: 2 },
  LOWER_LIP_E_MM: { mean: -2, sd: 2 },
};

/**
 * Ninguna con norma citada: todas dependen fuerte de edad/sexo en la
 * literatura de McNamara y no hay un valor único seguro que dar sin ese
 * ajuste. Se calculan igual (ver `analyses/mcnamara.ts`) — aquí solo no
 * hay contra qué compararlas todavía.
 */
const MCNAMARA_CLASSIC: FullNormTable = {
  A_TO_NPERP_MM: null,
  PG_TO_NPERP_MM: null,
  CO_A_MM: null,
  CO_GN_MM: null,
  MAXMAND_DIFFERENTIAL_MM: null,
  LOWER_FACE_HEIGHT_MM: null,
};

const DOWNS_TWEED_CLASSIC: FullNormTable = {
  FMA: { mean: 25, sd: 3 },
  FMIA: { mean: 65, sd: 5 },
  IMPA: { mean: 90, sd: 4 },
};

const CLASSIC_BY_ANALYSIS: Record<FullCephAnalysisType, FullNormTable> = {
  STEINER: STEINER_CLASSIC,
  RICKETTS: RICKETTS_CLASSIC,
  MCNAMARA: MCNAMARA_CLASSIC,
  DOWNS_TWEED: DOWNS_TWEED_CLASSIC,
};

/** Mismo dato citado que `../norms.ts` (alcance-ortodoncia.html, bloque H, hallazgo 1) — ningún dato mexicano nuevo para estas medidas. */
const MEXICAN_OVERRIDES: FullNormTable = {
  ANB: { mean: 3, sd: 2 },
  IMPA: { mean: 95, sd: 4 },
};

export function getFullNormTable(analysisType: FullCephAnalysisType, normSet: CephNormSet): FullNormTable {
  const classic = CLASSIC_BY_ANALYSIS[analysisType];
  if (normSet === "STANDARD") return classic;
  return { ...classic, ...MEXICAN_OVERRIDES };
}

export interface FullNormEvaluation {
  key: FullMeasurementKey;
  value: number | null;
  norm: NormRange | null;
  deviationSd: number | null;
  interpretation: NormInterpretation;
}

export function evaluateFullAgainstNorms(
  measurements: FullCephMeasurements,
  analysisType: FullCephAnalysisType,
  normSet: CephNormSet,
): FullNormEvaluation[] {
  const table = getFullNormTable(analysisType, normSet);
  const keys = ANALYSIS_MEASUREMENT_KEYS[analysisType];
  return keys.map((key) => {
    const value = measurements[key];
    const norm = table[key] ?? null;
    if (value === null || value === undefined) {
      return { key, value: null, norm, deviationSd: null, interpretation: "sin-medida" as const };
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
