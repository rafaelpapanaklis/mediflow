"use client";

// STUB provisional del Stage (un visor de un plano). T5 lo implementa:
// render del corte/volumen real + overlay de anotaciones + gestos (pan/zoom/
// pinch) + captura de puntos por herramienta. Por ahora solo dibuja el armazón
// del cuadrante para ver los layouts.
//
// TODO(T5): render real (canvas del cargador DICOM para 2D / lienzo del volumen
//   para vol3d), overlay SVG de `annos`, gestos y commitPoint por `tool`.
// TODO(T7): recibir el hook de render del cargador real.

import type { StageProps } from "./types";

export function Stage({ plane, planeLabel, sliceIndex, focused, compact, onFocus, annos }: StageProps) {
  const annosAqui = annos.filter((a) => a.plane === plane).length;
  return (
    <div
      className={"vc-stage-stub" + (focused ? " focus" : "") + (compact ? " compact" : "")}
      onPointerDown={onFocus}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: compact ? 0 : 240,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(120% 120% at 50% 30%, #1a2330 0%, #0c1118 70%)",
        border: focused ? "1px solid var(--accent, #2a6fdb)" : "1px solid #1e2733",
        borderRadius: 12,
        color: "#7d8aa0",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      <div style={{ textAlign: "center", lineHeight: 1.5 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#aeb9cc" }}>{planeLabel || plane}</div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          {plane === "vol3d" ? "volumen 3D" : `corte ${sliceIndex}`}
        </div>
        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
          {annosAqui ? `${annosAqui} anotación(es)` : "Stage — pendiente (T5)"}
        </div>
      </div>
    </div>
  );
}

export default Stage;
