"use client";

// STUB del panel de render de volumen. TODO(T6): Sólido/MIP + slider de umbral
// escribiendo en `setVol`; deshabilitar cuando !active.

import type { VolumePanelProps } from "../types";

const titleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#aeb9cc", margin: "0 0 6px" };
const stubStyle: React.CSSProperties = { fontSize: 11, color: "#6f7c92", margin: 0 };

export function VolumePanel({ vol, active }: VolumePanelProps) {
  return (
    <section className="vc-panel" style={{ padding: 12, borderBottom: "1px solid #161d27", opacity: active ? 1 : 0.5 }}>
      <h3 className="vc-panel-title" style={titleStyle}>Volumen 3D</h3>
      <p className="vc-panel-stub" style={stubStyle}>
        {active ? `modo ${vol.mode} · umbral ${vol.umbral}` : "inactivo (activa el plano 3D o MPR)"} — pendiente (T6)
      </p>
    </section>
  );
}

export default VolumePanel;
