"use client";

import { GROUPS } from "./data";
import type { LegendProps } from "./types";

/** Legend — specialty color legend. Ported from design jsx/odontogram.jsx. */
export function Legend({ lang }: LegendProps) {
  return (
    <div className="odo-legend">
      {GROUPS.map((g) => (
        <span key={g.id} className="odo-leg-item">
          <span className="odo-leg-dot" style={{ background: g.color }} />
          {g[lang]}
        </span>
      ))}
    </div>
  );
}
