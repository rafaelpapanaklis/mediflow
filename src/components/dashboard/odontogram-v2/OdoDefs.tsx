"use client";

import { Fragment } from "react";
import { GROUPS } from "./data";
import { VAR_TONO, type Tono } from "./colores";

/** Los patrones de cada especialidad y, con el mismo id, los del rojo/azul del estado (ws1-t6). */
const PATRONES: { id: string; color: string }[] = [
  ...GROUPS.map((g) => ({ id: g.id, color: g.color })),
  ...(Object.keys(VAR_TONO) as Tono[]).map((t) => ({ id: t, color: `var(${VAR_TONO[t]})` })),
];

/**
 * OdoDefs — global SVG <pattern> defs (stipple/dots/hatch per specialty color)
 * referenced by Surface2D/ToothGlyph fills. Ported from design jsx/surface2d.jsx.
 * Takes no props (see OdoDefsProps in types.ts).
 */
export function OdoDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {PATRONES.map((g) => (
          <Fragment key={g.id}>
            <pattern id={`stipple-${g.id}`} width="5" height="5" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" fill="#fff" />
              <circle cx="2.5" cy="2.5" r="1" style={{ fill: g.color }} />
            </pattern>
            <pattern id={`dots-${g.id}`} width="7" height="7" patternUnits="userSpaceOnUse">
              <rect width="7" height="7" fill="none" />
              <circle cx="3.5" cy="3.5" r="1.3" style={{ fill: g.color }} />
            </pattern>
            <pattern id={`hatch-${g.id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#fff" />
              <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: g.color }} strokeWidth="1.6" />
            </pattern>
          </Fragment>
        ))}
        <pattern id="hatch-gray" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#fff" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#9aa3af" strokeWidth="1.4" />
        </pattern>
      </defs>
    </svg>
  );
}
