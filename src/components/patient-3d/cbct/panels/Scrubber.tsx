"use client";

// Barra inferior: corte + reset de vista + zoom. Stub funcional (slider de
// corte y zoom). TODO(T5): reproducción/scrub táctil, gestos, comparar A/B.

import type { ScrubberProps } from "../types";
import { PLANE_MAX } from "../constants";
import { IcReset, IcZoomIn, IcZoomOut } from "../icons";

export function Scrubber({ plane, sliceIndex, setSlice, onReset, zoom, setZoom }: ScrubberProps) {
  const ibtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: 8,
    border: "1px solid #1e2733",
    background: "transparent",
    color: "#9aa7bd",
    cursor: "pointer",
  };
  return (
    <div className="vc-scrubber" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
      {plane !== "vol3d" && (
        <input
          type="range"
          min={1}
          max={PLANE_MAX[plane]}
          value={sliceIndex}
          onChange={(e) => setSlice(Number(e.target.value))}
          aria-label="Corte"
          style={{ flex: 1, accentColor: "var(--accent, #2a6fdb)" }}
        />
      )}
      {plane !== "vol3d" && (
        <span className="vc-slice-idx" style={{ fontSize: 11, color: "#7d8aa0", minWidth: 70, textAlign: "right" }}>
          corte {sliceIndex}/{PLANE_MAX[plane]}
        </span>
      )}
      <button type="button" title="Reiniciar vista" style={ibtn} onClick={onReset}>
        <IcReset />
      </button>
      <button type="button" title="Alejar" style={ibtn} onClick={() => setZoom((z) => Math.max(1, z / 1.2))}>
        <IcZoomOut />
      </button>
      <span className="vc-zoom-pct" style={{ fontSize: 11, color: "#9aa7bd", minWidth: 44, textAlign: "center" }}>
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" title="Acercar" style={ibtn} onClick={() => setZoom((z) => Math.min(6, z * 1.2))}>
        <IcZoomIn />
      </button>
    </div>
  );
}

export default Scrubber;
