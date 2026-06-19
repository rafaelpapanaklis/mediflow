"use client";

// Conmutador de plano activo (Axial/Coronal/Sagital/Volumen). Funcional ya.

import type { PlaneSwitchProps } from "../types";
import { PLANES } from "../constants";

export function PlaneSwitch({ plane, setPlane }: PlaneSwitchProps) {
  return (
    <div className="vc-planeswitch" role="tablist" style={{ display: "inline-flex", gap: 4 }}>
      {PLANES.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          aria-selected={plane === p.id}
          className={"vc-plane" + (plane === p.id ? " on" : "")}
          onClick={() => setPlane(p.id)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            minHeight: 40,
            borderRadius: 8,
            border: "1px solid " + (plane === p.id ? "var(--accent, #2a6fdb)" : "#1e2733"),
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            color: plane === p.id ? "#fff" : "#8a97ad",
            background: plane === p.id ? "var(--accent-soft, rgba(42,111,219,.17))" : "transparent",
          }}
        >
          <p.Icon />
          <span>{p.label}</span>
        </button>
      ))}
    </div>
  );
}

export default PlaneSwitch;
