// Ortodoncia — PDF del trazado cefalométrico (sección I de la revisión de
// lógica de uso). PURO: de la fila guardada (`orthodontic_cephalometry_
// analyses`) a lo que pinta `ceph-report-pdf.tsx`. Lo que necesita Prisma
// (clínica, paciente, doctor, la radiografía) lo junta la ruta
// `src/app/api/orthodontics/imagen/cefalometria/[id]/pdf/route.tsx`.
//
// COORDENADAS. `CephalometricTracer` guarda cada punto en PORCENTAJE (0–100)
// de su caja, que es de proporción 3:4 con la radiografía dentro en
// `object-contain`. El PDF dibuja sobre un viewBox en «px»: se usa una caja
// de 300 × 400 (la misma 3:4) con la imagen también en `contain`, así que el
// punto queda donde el doctor lo marcó: x·3, y·4.

import type { CephPoints } from "../landmarks";
import { computeFullCephAnalysis } from "../full-analysis";
import { FULL_CEPH_ANALYSIS_LABELS, type FullCephAnalysisType } from "../norms-extended";
import type { CephNormSet } from "../norms";
import {
  DEFAULT_PLANES_FOR_ANALYSIS,
  buildCephReportDots,
  buildCephReportPlanes,
  buildCephReportRows,
} from "./build-ceph-report-data";
import type { CephReportPdfData } from "./ceph-report-pdf-types";

export const CAJA_DEL_TRAZADO = { widthPx: 300, heightPx: 400 } as const;

const ETIQUETA_DE_NORMA: Record<CephNormSet, string> = {
  STANDARD: "Norma clásica",
  MEXICAN: "Norma mexicana",
};

const ETIQUETA_DE_TRAZADO: Record<string, string> = {
  INITIAL: "Inicial",
  PROGRESS: "Progreso",
  FINAL: "Final",
};

function esTipoDeAnalisis(v: string): v is FullCephAnalysisType {
  return v in FULL_CEPH_ANALYSIS_LABELS;
}

/** De porcentaje de la caja 3:4 a la caja del PDF. Descarta lo que no es un punto. */
export function puntosEnLaCaja(points: unknown): CephPoints {
  const out: Record<string, { x: number; y: number }> = {};
  if (!points || typeof points !== "object") return out as CephPoints;
  for (const [id, p] of Object.entries(points as Record<string, unknown>)) {
    const x = (p as { x?: unknown } | null)?.x;
    const y = (p as { y?: unknown } | null)?.y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    out[id] = {
      x: (x / 100) * CAJA_DEL_TRAZADO.widthPx,
      y: (y / 100) * CAJA_DEL_TRAZADO.heightPx,
    };
  }
  return out as CephPoints;
}

export interface FilaDelTrazado {
  kind: string;
  analysisType: string;
  normSet: string;
  /** Tal como se guardó (en % de la caja): las medidas se calculan igual que al guardar. */
  points: unknown;
  /** px por mm (pese al nombre de la columna, ver `calibration.ts`). */
  calibrationMmPerPixel: number | null;
  createdAt: Date;
}

export function datosDelTrazado(args: {
  fila: FilaDelTrazado;
  cabecera: Pick<CephReportPdfData, "clinicName"> & Partial<CephReportPdfData>;
  patientName: string;
  patientDobIso: string | null;
  doctorName: string;
  doctorCedula: string | null;
  /** Radiografía ya lista para @react-pdf (data URL PNG/JPEG), o null. */
  imagenDataUrl: string | null;
  ahora: Date;
}): CephReportPdfData {
  const { fila } = args;
  const tipo: FullCephAnalysisType = esTipoDeAnalisis(fila.analysisType) ? fila.analysisType : "STEINER";
  const norma: CephNormSet = fila.normSet === "MEXICAN" ? "MEXICAN" : "STANDARD";
  const guardados = (fila.points && typeof fila.points === "object" ? fila.points : {}) as CephPoints;
  const calibracion = fila.calibrationMmPerPixel && fila.calibrationMmPerPixel > 0 ? fila.calibrationMmPerPixel : null;
  const medidas = computeFullCephAnalysis(guardados, calibracion);
  const enCaja = puntosEnLaCaja(fila.points);

  return {
    ...args.cabecera,
    patientName: args.patientName,
    patientDobIso: args.patientDobIso,
    doctorName: args.doctorName,
    doctorCedula: args.doctorCedula,
    analysisLabel: FULL_CEPH_ANALYSIS_LABELS[tipo],
    normSetLabel: ETIQUETA_DE_NORMA[norma],
    kindLabel: ETIQUETA_DE_TRAZADO[fila.kind] ?? fila.kind,
    tracingDateIso: fila.createdAt.toISOString(),
    generatedAtIso: args.ahora.toISOString(),
    rows: buildCephReportRows(medidas, tipo, norma),
    image: args.imagenDataUrl ? { url: args.imagenDataUrl, ...CAJA_DEL_TRAZADO } : null,
    points: args.imagenDataUrl ? buildCephReportDots(enCaja) : [],
    planes: args.imagenDataUrl ? buildCephReportPlanes(enCaja, DEFAULT_PLANES_FOR_ANALYSIS[tipo]) : [],
    calibrationPxPerMm: calibracion,
  };
}

/** ¿Estos bytes son PNG o JPEG (lo único que pinta @react-pdf)? Devuelve el mime o null. */
export function mimeDeImagen(buf: Uint8Array): "image/png" | "image/jpeg" | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}
