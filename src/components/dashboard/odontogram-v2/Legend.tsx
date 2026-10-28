"use client";

import { memo } from "react";
import { GROUPS, I18N } from "./data";
import type { LegendProps } from "./types";
import { VAR_TONO } from "./colores";

/** Legend — specialty color legend. Ported from design jsx/odontogram.jsx. Con estado (ws1-t6),
 *  delante van rojo = por hacer y azul = realizado, que mandan sobre el color de la especialidad. */
export const Legend = memo(function Legend({ lang, conEstado, soloEstado }: LegendProps) {
  const t = I18N[lang];
  return (
    <div className="odo-legend">
      {conEstado && (
        <>
          <span className="odo-leg-estado"><span className="odo-leg-dot" style={{ background: `var(${VAR_TONO.rojo})` }} />{t.estadoPorHacer}</span>
          <span className="odo-leg-estado"><span className="odo-leg-dot" style={{ background: `var(${VAR_TONO.azul})` }} />{t.estadoHecho}</span>
        </>
      )}
      {!soloEstado && GROUPS.map((g) => (
        <span key={g.id} className="odo-leg-item">
          <span className="odo-leg-dot" style={{ background: g.color }} />
          {g[lang]}
        </span>
      ))}
    </div>
  );
});
