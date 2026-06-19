"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CbctStudyViewer — ENCHUFA el cargador real + persistencia al <CbctViewer/>
// rediseñado y lo abre desde Models3DTab (WS2-T7).
//
// Bajo la decisión "solo data" (no se toca el Stage): el ÁREA DE IMAGEN del
// visor sigue siendo el stub de la fundación hasta que T5 implemente el render.
// Aquí ya quedan REALES: la escala mmPorPixel (de cabeceras DICOM), la
// persistencia (annotations/doctorNotes vía API multi-tenant) y el conteo de
// cortes / espaciado del header. Si el set no se puede leer como CBCT, cae al
// visor clásico (DicomSetViewer) vía onFallback.
//
// useCbctStudy carga en segundo plano (cacheado): el visor se ve al instante;
// mmPorPixel y los datos del header se rellenan al terminar.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo } from "react";
import { CbctViewer } from "./CbctViewer";
import { useCbctStudy } from "./useCbctStudy";
import { makeCbctHandlers, parseInitialAnnos } from "./persistence";
import type { Anno } from "./types";

export interface CbctStudyFile {
  id: string;
  name: string;
  url: string;
  size?: number | null;
  createdAt?: string;
  doctorNotes?: string | null;
  annotations?: unknown;
}

export interface CbctStudyViewerProps {
  patientId: string;
  patientName?: string;
  file: CbctStudyFile;
  onClose: () => void;
  /** Llamado si el set no se puede leer como CBCT → el padre cae al clásico. */
  onFallback?: () => void;
}

export function CbctStudyViewer({
  patientId,
  patientName,
  file,
  onClose,
  onFallback,
}: CbctStudyViewerProps) {
  const study = useCbctStudy({ fileId: file.id, url: file.url });

  // Auto-fallback al visor clásico si el set no es CBCT legible.
  useEffect(() => {
    if ((study.status === "empty" || study.status === "error") && onFallback) {
      onFallback();
    }
  }, [study.status, onFallback]);

  const initialAnnos: Anno[] = useMemo(
    () => parseInitialAnnos(file.annotations),
    [file.annotations],
  );
  const handlers = useMemo(() => makeCbctHandlers(patientId, file.id), [patientId, file.id]);

  const estudio = useMemo(
    () => ({
      id: file.id,
      fileId: file.id,
      titulo: file.name,
      modalidad: "CBCT",
      numCortes: study.dims ? study.dims.depth : undefined,
      espaciadoMm:
        study.espaciadoMm != null ? Math.round(study.espaciadoMm * 100) / 100 : undefined,
      fechaISO: file.createdAt,
    }),
    [file.id, file.name, file.createdAt, study.dims, study.espaciadoMm],
  );

  const paciente = useMemo(
    () => ({ id: patientId, nombre: patientName || "Paciente" }),
    [patientId, patientName],
  );

  const onCerrar = useCallback(() => onClose(), [onClose]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <CbctViewer
        estudio={estudio}
        paciente={paciente}
        mmPorPixel={study.mmPorPixel}
        initialAnnos={initialAnnos}
        initialNotes={file.doctorNotes ?? ""}
        onGuardarHallazgos={handlers.onGuardarHallazgos}
        onGuardarNota={handlers.onGuardarNota}
        onCerrar={onCerrar}
      />
      {study.status === "loading" && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 6,
            background: "rgba(12,17,24,.92)",
            border: "1px solid #1e2733",
            color: "#aeb9cc",
            fontSize: 12,
            borderRadius: 999,
            padding: "6px 14px",
            pointerEvents: "none",
          }}
        >
          Leyendo cortes del CBCT…
          {study.progress.total ? ` ${study.progress.done}/${study.progress.total}` : ""}
        </div>
      )}
    </div>
  );
}

export default CbctStudyViewer;
