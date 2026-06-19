"use client";

// Control segmentado (selector de layout en el header). Funcional ya en la
// fundación porque es chrome de navegación trivial.

import type { SegProps } from "../types";

export function Seg({ options, value, onChange }: SegProps) {
  return (
    <div className="vc-seg" role="tablist" style={{ display: "inline-flex", gap: 4, background: "#0e141d", padding: 4, borderRadius: 10 }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          className={"vc-seg-btn" + (value === o.id ? " on" : "")}
          onClick={() => onChange(o.id)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            color: value === o.id ? "#fff" : "#8a97ad",
            background: value === o.id ? "var(--accent, #2a6fdb)" : "transparent",
          }}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export default Seg;
