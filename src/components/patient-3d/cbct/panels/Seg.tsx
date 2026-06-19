"use client";

// Control segmentado: selector de layout (header) y toggles compactos (p. ej. el
// modo de volumen Sólido/MIP con `small`). El estilo vive en cbct.css (vc-seg /
// vc-seg-btn). `small` es opcional y NO altera el contrato SegProps (la cabecera
// lo omite → variante inline; los paneles lo activan → segmentos a ancho igual).

import type { SegProps } from "../types";
import "../cbct.css";

export function Seg({ options, value, onChange, small }: SegProps & { small?: boolean }) {
  return (
    <div className={"vc-seg" + (small ? " sm" : "")} role="tablist">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={"vc-seg-btn" + (on ? " on" : "")}
            onClick={() => onChange(o.id)}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default Seg;
