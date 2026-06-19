"use client";

// STUB del panel de ventana de densidad (HU). TODO(T6): presets HU_PRESETS +
// sliders de brillo/contraste con escritura en `setHu`.

import type { WindowPanelProps } from "../types";

const titleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#aeb9cc", margin: "0 0 6px" };
const stubStyle: React.CSSProperties = { fontSize: 11, color: "#6f7c92", margin: 0 };

export function WindowPanel({ hu }: WindowPanelProps) {
  return (
    <section className="vc-panel" style={{ padding: 12, borderBottom: "1px solid #161d27" }}>
      <h3 className="vc-panel-title" style={titleStyle}>Ventana de densidad</h3>
      <p className="vc-panel-stub" style={stubStyle}>
        Preset: {hu.preset} · brillo {hu.brillo} · contraste {hu.contraste} — pendiente (T6)
      </p>
    </section>
  );
}

export default WindowPanel;
