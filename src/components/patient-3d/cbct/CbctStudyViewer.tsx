"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CbctStudyViewer — ENCHUFA el cargador real + el RENDER real + persistencia al
// <CbctViewer/> rediseñado y lo abre desde Models3DTab (WS2-T7 = datos; WS2-T8 =
// conecta el render al Stage de T5 vía renderContent).
//
// Quedan REALES: el ÁREA DE IMAGEN (corte 2D rasterizado por SliceCanvas y
// volumen 3D por VolumeCanvas, inyectados al Stage vía renderContent), la escala
// mmPorPixel (de cabeceras DICOM), la persistencia (annotations/doctorNotes vía
// API multi-tenant) y el conteo de cortes / espaciado del header. Si el set no se
// puede leer como CBCT, cae al visor clásico (DicomSetViewer) vía onFallback.
//
// useCbctStudy carga en segundo plano (cacheado): el visor se ve al instante con
// el placeholder; al terminar, renderContent pinta los cortes/volumen reales y se
// rellenan mmPorPixel y los datos del header.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { CbctViewer } from "./CbctViewer";
import { useCbctStudy } from "./useCbctStudy";
import { makeCbctHandlers, parseInitialAnnos, parseInitialNotes } from "./persistence";
import { SliceCanvas } from "./render/SliceCanvas";
import { VolumeCanvas } from "./render/VolumeCanvas";
import { PLANE_MAX } from "./constants";
import type { Anno, EstudioNota, Plane, RenderContent } from "./types";

// Estilo del lienzo del corte 2D: rellena la caja de imagen del Stage al 100%×100%
// (igual que el placeholder de T5) para que el overlay de anotaciones quede
// alineado. El pan/zoom los aplica el Stage por transform del contenedor; aquí
// solo se pinta el corte (físico-proporcional) estirado a la caja.
const SLICE_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
};

// El volumen 3D (Dicom3DVolume) trae alto fijo + sus propios controles internos:
// lo centramos vertical y a todo el ancho de la caja.
const VOL_WRAP_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  overflow: "hidden",
};

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
  // FIX1: deserializa las notas (lista JSON; 1 nota si es texto plano legado).
  const initialNotes: EstudioNota[] = useMemo(
    () => parseInitialNotes(file.doctorNotes),
    [file.doctorNotes],
  );
  const handlers = useMemo(() => makeCbctHandlers(patientId, file.id), [patientId, file.id]);

  // FIX3: rango de cortes REAL por plano (de las dimensiones del volumen). Mientras
  // el estudio carga (dims null) cae al PLANE_MAX fijo.
  const planeMax = useMemo<Record<Plane, number>>(() => {
    const d = study.dims;
    if (!d) return PLANE_MAX;
    return { axial: d.depth, coronal: d.rows, sagital: d.cols, vol3d: 1 };
  }, [study.dims]);

  // Render REAL del corte/volumen para el Stage (decisión "opción 2"): se inyecta
  // SOLO con el estudio listo; mientras carga/empty/error devolvemos undefined y
  // el Stage cae a su placeholder procedural. vol3d → volumen 3D real
  // (Dicom3DVolume); el resto de planos → corte 2D rasterizado (HU Int16 → canvas)
  // con la ventana W/L base del estudio. Es PURO (el Stage lo invoca también en la
  // lupa) y respeta multi-tenant: no toca red, la persistencia va por los handlers.
  const renderContent = useMemo<RenderContent | undefined>(() => {
    if (study.status !== "ready" || study.slices.length === 0) return undefined;
    const slices = study.slices;
    const baseC = study.defaultHU ? study.defaultHU.center : undefined;
    const baseW = study.defaultHU ? study.defaultHU.width : undefined;
    return ({ plane, sliceIndex, view, hu, vol }) => {
      if (plane === "vol3d") {
        return (
          <div style={VOL_WRAP_STYLE}>
            <VolumeCanvas slices={slices} vol={vol} yaw={view.yaw} />
          </div>
        );
      }
      return (
        <SliceCanvas
          slices={slices}
          plane={plane}
          sliceIndex={sliceIndex}
          hu={hu}
          defaultCenter={baseC}
          defaultWidth={baseW}
          style={SLICE_STYLE}
        />
      );
    };
  }, [study.status, study.slices, study.defaultHU]);

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
        renderContent={renderContent}
        initialAnnos={initialAnnos}
        initialNotes={initialNotes}
        planeMax={planeMax}
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
