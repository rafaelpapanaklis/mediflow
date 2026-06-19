"use client";

// Barra inferior (T5): corte (planos 2D) o pista de rotación (vol3d) + zoom +
// reiniciar vista. Botones ≥48px (táctil). El zoom va por rueda/pellizco en el
// Stage y también por estos botones; aquí se refleja el % actual. Estilo fino
// global = T6.

import type { ScrubberProps } from "../types";
import { PLANE_MAX } from "../constants";
import { IcReset, IcZoomIn, IcZoomOut, IcCube } from "../icons";

export function Scrubber({ plane, sliceIndex, setSlice, onReset, zoom, setZoom }: ScrubberProps) {
  const is3d = plane === "vol3d";
  const ibtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    flex: "0 0 auto",
    borderRadius: 10,
    border: "1px solid #1e2733",
    background: "transparent",
    color: "#9aa7bd",
    cursor: "pointer",
  };
  const pct = Math.round(zoom * 100);
  return (
    <div
      className="vc-scrubber"
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#0c1118", border: "1px solid #161d27", borderRadius: 12, flexWrap: "wrap" }}
    >
      {is3d ? (
        <span className="vc-scrub-hint" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "#8a97ad", marginRight: "auto", paddingLeft: 4 }}>
          <IcCube /> Arrastra para rotar · rueda o pellizco para zoom
        </span>
      ) : (
        <>
          <span className="vc-scrub-lb" style={{ fontSize: 12, color: "#8a97ad", paddingLeft: 4 }}>Corte</span>
          <input
            type="range"
            min={1}
            max={PLANE_MAX[plane]}
            value={sliceIndex}
            aria-label="Corte"
            onChange={(e) => setSlice(Number(e.target.value))}
            style={{ flex: 1, minWidth: 120, accentColor: "var(--accent,#2a6fdb)", height: 28 }}
          />
          <span className="vc-scrub-num" style={{ fontSize: 12, color: "#cdd5e1", minWidth: 76, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {sliceIndex}
            <span style={{ color: "#6f7c92" }}> / {PLANE_MAX[plane]}</span>
          </span>
        </>
      )}
      <button type="button" title="Alejar" aria-label="Alejar" style={ibtn} onClick={() => setZoom((z) => Math.max(0.4, z / 1.18))}>
        <IcZoomOut />
      </button>
      <span className="vc-zoom-pct" style={{ fontSize: 12, color: "#cdd5e1", minWidth: 46, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
      <button type="button" title="Acercar" aria-label="Acercar" style={ibtn} onClick={() => setZoom((z) => Math.min(6, z * 1.18))}>
        <IcZoomIn />
      </button>
      <button type="button" title="Reiniciar vista" aria-label="Reiniciar vista" style={ibtn} onClick={onReset}>
        <IcReset />
      </button>
    </div>
  );
}

export default Scrubber;
