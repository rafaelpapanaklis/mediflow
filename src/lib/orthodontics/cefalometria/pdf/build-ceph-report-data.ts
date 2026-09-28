// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Puentes puros
// entre lo que ya calcula esta carpeta (medidas, normas, planos) y lo que
// pide el componente del PDF (`ceph-report-pdf.tsx`). Sin Prisma, sin
// React, sin `@react-pdf/renderer` — solo formateo y geometría. Quien
// arme el resto del objeto (datos de clínica/paciente/doctor, que sí
// necesitan Prisma) es la Parte B, en `src/app/actions/orthodontics/imagen/`.

import type { CephPoints } from "../landmarks";
import { findCephLandmark } from "../landmarks";
import { resolveCephPlane, CEPH_PLANES, type CephPlaneId } from "../plane-lines";
import type { FullCephMeasurements } from "../full-analysis";
import {
  evaluateFullAgainstNorms,
  MEASUREMENT_LABELS,
  MEASUREMENT_UNIT,
  type FullCephAnalysisType,
  type FullNormEvaluation,
} from "../norms-extended";
import { interpretationPhrase } from "../interpretation";
import type { CephNormSet } from "../norms";
import type { CephReportLandmarkDot, CephReportPlaneLine, CephReportRow } from "./ceph-report-pdf-types";

function fmtValue(evalRow: FullNormEvaluation): string {
  if (evalRow.value === null) return "—";
  const unit = MEASUREMENT_UNIT[evalRow.key];
  return unit === "deg" ? `${evalRow.value}°` : `${evalRow.value} mm`;
}

function fmtNorm(evalRow: FullNormEvaluation): string | null {
  if (!evalRow.norm) return null;
  const unit = MEASUREMENT_UNIT[evalRow.key];
  const suffix = unit === "deg" ? "°" : " mm";
  return `${evalRow.norm.mean}${suffix} ± ${evalRow.norm.sd}${suffix}`;
}

function fmtDeviation(evalRow: FullNormEvaluation): string | null {
  if (evalRow.deviationSd === null) return null;
  const sign = evalRow.deviationSd > 0 ? "+" : "";
  return `${sign}${evalRow.deviationSd} DE`;
}

/** Evalúa contra normas y formatea — la tabla completa que pinta el PDF (y que puede reusar la UI de la Parte B). */
export function buildCephReportRows(
  measurements: FullCephMeasurements,
  analysisType: FullCephAnalysisType,
  normSet: CephNormSet,
): CephReportRow[] {
  return evaluateFullAgainstNorms(measurements, analysisType, normSet).map((e) => ({
    key: e.key,
    label: MEASUREMENT_LABELS[e.key],
    valueLabel: fmtValue(e),
    normLabel: fmtNorm(e),
    deviationLabel: fmtDeviation(e),
    interpretation: e.interpretation,
    interpretationText: interpretationPhrase(e.key, e.interpretation),
  }));
}

/** Puntos marcados → puntos a dibujar (con su etiqueta corta). */
export function buildCephReportDots(points: CephPoints): CephReportLandmarkDot[] {
  return (Object.keys(points) as Array<keyof CephPoints>)
    .filter((id) => points[id] !== undefined)
    .map((id) => {
      const p = points[id]!;
      return { id, label: findCephLandmark(id).label, x: p.x, y: p.y };
    });
}

/** Planos ya resueltos (solo los que se pueden dibujar con el trazado actual) para el/los ids pedidos. */
export function buildCephReportPlanes(points: CephPoints, planeIds: CephPlaneId[]): CephReportPlaneLine[] {
  const byId = new Map(CEPH_PLANES.map((p) => [p.id, p]));
  const out: CephReportPlaneLine[] = [];
  for (const id of planeIds) {
    const line = resolveCephPlane(id, points);
    const def = byId.get(id);
    if (line && def) out.push({ id, label: def.label, a: line[0], b: line[1] });
  }
  return out;
}

/** Planos por defecto que tiene sentido dibujar para cada análisis — la Parte B puede pasar otra lista si el doctor activa/desactiva planos a mano. */
export const DEFAULT_PLANES_FOR_ANALYSIS: Record<FullCephAnalysisType, CephPlaneId[]> = {
  STEINER: ["SN", "FH", "MANDIBULAR_GO_GN", "OCCLUSAL", "NA", "NB", "U1_AXIS", "L1_AXIS"],
  RICKETTS: ["FH", "BA_N", "PT_GN", "MANDIBULAR_GO_GN", "N_POG", "E_LINE"],
  MCNAMARA: ["FH", "N_POG"],
  DOWNS_TWEED: ["FH", "MANDIBULAR_GO_ME", "L1_AXIS"],
};
