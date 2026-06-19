"use client";

// Conmutador de plano activo (Axial / Coronal / Sagital / Volumen 3D) — T5.
// Control segmentado, ≥48px por botón (táctil). Estilo fino global = T6.

import type { PlaneSwitchProps } from "../types";
import { PLANES } from "../constants";

export function PlaneSwitch({ plane, setPlane }: PlaneSwitchProps) {
  return (
    <div
      className="vc-planeswitch"
      role="tablist"
      aria-label="Plano activo"
      style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, background: "#0e141d", padding: 4, borderRadius: 12, border: "1px solid #161d27" }}
    >
      {PLANES.map((p) => {
        const on = plane === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={on}
            title={p.label}
            className={"vc-plane" + (on ? " on" : "")}
            onClick={() => setPlane(p.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "0 13px",
              minHeight: 48,
              borderRadius: 9,
              border: "none",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              color: on ? "#fff" : "#8a97ad",
              background: on ? "var(--accent,#2a6fdb)" : "transparent",
              transition: "background .12s, color .12s",
            }}
          >
            <p.Icon />
            <span className="vc-plane-label">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default PlaneSwitch;
