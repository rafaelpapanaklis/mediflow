"use client";

/* ═══════════════════════════════════════════════════════════════════════
 * COPIA DEL INSTITUTO del odontograma v2.
 *
 * Origen: la carpeta del odontograma v2 bajo src/components/dashboard/ (el vertical DENTAL).
 * Desde WS2-T3 el instituto NO importa aquel módulo: tiene el suyo. El
 * original se queda donde está y sigue siendo del dental — esto es una
 * BIFURCACIÓN, no un movimiento.
 *
 * 🔴 LO QUE ESO SIGNIFICA, Y HAY QUE SABERLO ANTES DE TOCAR NADA: un
 * arreglo del dental YA NO LLEGA SOLO. Si el dental corrige la geometría
 * de un diente o agrega un hallazgo al catálogo, aquí no pasa nada hasta
 * que alguien lo traiga a mano. Se hizo a propósito: al revés también
 * valía —un cambio del dental cambiaba el odontograma de una escuela sin
 * que nadie del instituto lo pidiera— y de los dos riesgos, el instituto
 * prefiere quedarse atrás a que le muevan el expediente clínico.
 * ═══════════════════════════════════════════════════════════════════════ */

import { memo } from "react";
import { GROUPS } from "./data";
import type { LegendProps } from "./types";

/** Legend — specialty color legend. Ported from design jsx/odontogram.jsx. */
export const Legend = memo(function Legend({ lang }: LegendProps) {
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
});
