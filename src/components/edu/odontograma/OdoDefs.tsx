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

import { Fragment } from "react";
import { GROUPS } from "./data";

/**
 * OdoDefs — global SVG <pattern> defs (stipple/dots/hatch per specialty color)
 * referenced by Surface2D/ToothGlyph fills. Ported from design jsx/surface2d.jsx.
 * Takes no props (see OdoDefsProps in types.ts).
 */
export function OdoDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {GROUPS.map((g) => (
          <Fragment key={g.id}>
            <pattern id={`stipple-${g.id}`} width="5" height="5" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" fill="#fff" />
              <circle cx="2.5" cy="2.5" r="1" fill={g.color} />
            </pattern>
            <pattern id={`dots-${g.id}`} width="7" height="7" patternUnits="userSpaceOnUse">
              <rect width="7" height="7" fill="none" />
              <circle cx="3.5" cy="3.5" r="1.3" fill={g.color} />
            </pattern>
            <pattern id={`hatch-${g.id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#fff" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={g.color} strokeWidth="1.6" />
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
