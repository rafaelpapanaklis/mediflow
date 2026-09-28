// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Types del PDF del
// análisis, separados del .tsx para que server actions/servicios puedan
// importarlos sin arrastrar @react-pdf/renderer al bundle — mismo patrón
// que `../../pdf-templates/comparison-pdf-types.ts`.
//
// Quien arma este objeto (Parte B) ya resolvió qué filas y qué planos
// mostrar — este archivo no vuelve a calcular nada, solo pinta lo que le
// dan. `rows` viene de `evaluateFullAgainstNorms` + `interpretationPhrase`
// (`../norms-extended.ts`, `../interpretation.ts`); `planes` de
// `resolveCephPlane`/`availableCephPlanes` (`../plane-lines.ts`).

import type { ClinicLetterheadClinic } from "../../../pdf/clinic-letterhead";

export interface CephReportPoint {
  x: number;
  y: number;
}

export interface CephReportLandmarkDot extends CephReportPoint {
  id: string;
  label: string;
}

export interface CephReportPlaneLine {
  id: string;
  label: string;
  a: CephReportPoint;
  b: CephReportPoint;
}

export interface CephReportRow {
  key: string;
  label: string;
  /** Valor ya formateado ("82.3°", "4.1 mm") o "—" si la medida es null. */
  valueLabel: string;
  /** "82° ± 2°" o null si no hay norma citada para esta medida. */
  normLabel: string | null;
  /** "+2.0 DE" o null (sin norma o sin medida). */
  deviationLabel: string | null;
  interpretation: "normal" | "aumentado" | "disminuido" | "sin-norma" | "sin-medida";
  /** Frase corta de `interpretationPhrase`, o null. */
  interpretationText: string | null;
}

export interface CephReportPdfData extends ClinicLetterheadClinic {
  patientName: string;
  patientDobIso: string | null;
  doctorName: string;
  doctorCedula: string | null;
  /** "Steiner", "Ricketts", "McNamara", "Downs / Tweed". */
  analysisLabel: string;
  /** "Norma clásica" o "Norma mexicana". */
  normSetLabel: string;
  /** "Inicial", "Progreso", "Final". */
  kindLabel: string;
  tracingDateIso: string;
  generatedAtIso: string;
  rows: CephReportRow[];
  /** null = sin radiografía adjunta todavía; el reporte sale solo con la tabla. */
  image: {
    url: string;
    /** Tamaño natural de la imagen, en el mismo espacio de coordenadas que `points`/`planes`. */
    widthPx: number;
    heightPx: number;
  } | null;
  points: CephReportLandmarkDot[];
  planes: CephReportPlaneLine[];
  /** null = trazado sin calibrar — el PDF avisa que las medidas en mm no están disponibles. */
  calibrationPxPerMm: number | null;
}
