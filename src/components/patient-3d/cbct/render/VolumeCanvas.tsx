"use client";

// ─────────────────────────────────────────────────────────────────────────────
// VolumeCanvas — render del VOLUMEN 3D (vol3d) del CBCT rediseñado (WS2-T7).
//
// ENVUELVE/REUSA el componente probado Dicom3DVolume (three.js r184, ray casting
// con colormap óseo + on-demand + robustez ante pérdida de contexto WebGL). No
// reimplementa nada del volumen.
//
// WS2-T9: `vol` (modo Sólido/MIP + umbral del panel) YA se inyecta a
// Dicom3DVolume, que ahora reacciona al panel en vez de a sus botones internos
// (antes el panel derecho no afectaba al volumen 3D — bug P0). `yaw` se pasa
// también; la rotación efectiva la sigue manejando OrbitControls (arrastre
// directo sobre el canvas 3D) para no duplicar/romper el control de cámara.
// ─────────────────────────────────────────────────────────────────────────────

import dynamic from "next/dynamic";
import type { DecodedSlice } from "../../dicom-decode-core";
import type { VolState } from "../types";
import type { VolSlice } from "../../Dicom3DVolume";

// three.js solo se descarga al abrir el volumen (code-split), igual que en
// DicomSetViewer.
const Dicom3DVolume = dynamic(() => import("../../Dicom3DVolume"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 460,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#7d8aa0",
        fontSize: 13,
      }}
    >
      Preparando volumen 3D…
    </div>
  ),
});

export interface VolumeCanvasProps {
  slices: DecodedSlice[];
  /** modo/umbral del panel de volumen (T6). Costura: ver nota de cabecera. */
  vol?: VolState;
  /** rotación (yaw) del volumen. Costura: ver nota de cabecera. */
  yaw?: number;
  className?: string;
}

export function VolumeCanvas({ slices, vol, yaw, className }: VolumeCanvasProps) {
  if (!slices || slices.length === 0) return null;
  // Dicom3DVolume lee pixels por índice (HU Int16, compatible); su VolSlice aún
  // tipa Float32Array, así que adaptamos el tipo aquí (igual que DicomSetViewer)
  // sin tocar ese archivo.
  return (
    <div className={className}>
      <Dicom3DVolume slices={slices as unknown as VolSlice[]} vol={vol} yaw={yaw} />
    </div>
  );
}

export default VolumeCanvas;
