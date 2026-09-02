"use client";

import { memo } from "react";
import type { MouseEventHandler, ReactElement } from "react";
import { C as ISO_C, toScreen } from "@/lib/floor-plan/iso";
import type { DrawOpts, ElementType, Rotation } from "@/lib/floor-plan/element-types";
import s from "./floor-plan.module.css";

/**
 * EL LIENZO ISOMÉTRICO — la parte que los dos productos dibujaban DOS VECES.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ HAY AQUÍ Y QUÉ NO
 *
 * Aquí está el DIBUJO: las baldosas, el mueble con su etiqueta, el
 * fantasma de lo que se va a soltar y la marca de selección. Nada más.
 *
 * ⛔ NO está la interacción. El arrastre, el desplazamiento del lienzo, el
 * zoom, el historial y el guardado son de cada editor y siguen ahí: el
 * dental arrastra con `requestAnimationFrame` sobre un `viewBox` fijo y
 * desplaza con la herramienta de mano; el instituto dibuja el SVG a su
 * tamaño real y deja que el hueco se desplace solo. Son dos formas
 * legítimas de resolver lo mismo y unificarlas sería reescribir el editor
 * que once clínicas usan hoy — que es exactamente lo que no se pidió.
 *
 * ── LO QUE SE UNIFICÓ, Y POR QUÉ SE VE DISTINTO ────────────────────────
 * 🔴 La rotación envuelve SOLO al dibujo. El editor del dental giraba el
 * grupo entero, y con él la etiqueta del sillón y la caja de selección: a
 * 90° el nombre se leía de lado y el recuadro salía torcido. El del
 * instituto ya lo hacía bien. Gana el que lo hacía bien. El mueble gira
 * exactamente igual que antes — lo que deja de girar es el texto.
 *
 * ── EL TRADUCTOR DE TOKENS VIAJA CON EL DIBUJO ─────────────────────────
 * 🔴 Las tres piezas llevan `.fp` en su propio `<g>`. `.fp` es el bloque
 * que traduce `--fp-*` (lo que mapea cada producto) a los `--fpc-*` que
 * leen `.tile`, `.chairLabel` y `.selection`, y son variables: heredan
 * hacia dentro del SVG sin pintar nada. Sin esto el dibujo solo tenía
 * color dentro de `FloorCanvasBox` —el instituto lo usa, el editor del
 * dental no—: en el dental las baldosas se quedaban SIN relleno (negras)
 * y la etiqueta del sillón sin halo. Ponerlo aquí es lo que hace que la
 * capa sirva en cualquier anfitrión, no solo en el que la estrenó.
 *
 * ── EL SUELO SE MEMOIZA ────────────────────────────────────────────────
 * ⚠️ Una rejilla de 32×24 son 768 polígonos. El dental los reconstruía en
 * CADA render, incluido cada fotograma de un arrastre. `memo` sobre
 * cuatro números los deja quietos mientras no cambie la rejilla.
 */

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL SUELO
// ═══════════════════════════════════════════════════════════════════════

export interface IsoTilesProps {
  cols: number;
  rows: number;
  /** Origen en pantalla de la celda (0,0). */
  ox?: number;
  oy?: number;
}

export const IsoTiles = memo(function IsoTiles({ cols, rows, ox = 0, oy = 0 }: IsoTilesProps) {
  const celdas: ReactElement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const A = toScreen(c, r, ox, oy);
      const B = toScreen(c + 1, r, ox, oy);
      const D = toScreen(c + 1, r + 1, ox, oy);
      const E = toScreen(c, r + 1, ox, oy);
      celdas.push(
        <polygon
          key={`t${c}-${r}`}
          className={`${s.tile} ${(c + r) % 2 === 0 ? s.tileA : s.tileB}`}
          points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${D[0]},${D[1]} ${E[0]},${E[1]}`}
        />,
      );
    }
  }
  return <g className={s.fp}>{celdas}</g>;
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · UN ELEMENTO DEL PISO
// ═══════════════════════════════════════════════════════════════════════

export interface IsoElementProps {
  /** El tipo del catálogo, ya resuelto por el llamador. */
  type: ElementType;
  /** Dónde se pinta AHORA (durante un arrastre no es su col/row guardada). */
  col: number;
  row: number;
  rotation: Rotation;
  ox?: number;
  oy?: number;
  /** Id del elemento en el plano: lo lee el "clic en el fondo deselecciona". */
  elementId: number;
  /** El nombre que flota encima (solo sillones). */
  label?: string | null;
  /** El nombre se pinta en rojo: sin ligar, o ligado a algo que ya no existe. */
  labelBad?: boolean;
  selected?: boolean;
  moving?: boolean;
  /** Sin cursor de mover (modo en vivo, o quien no puede editar). */
  locked?: boolean;
  /** `isOpen` / `isOccupied` — los lee el catálogo al dibujar. */
  drawOpts?: DrawOpts;
  onMouseDown?: MouseEventHandler<SVGGElement>;
  onMouseEnter?: MouseEventHandler<SVGGElement>;
  onMouseLeave?: MouseEventHandler<SVGGElement>;
}

export function IsoElement({
  type,
  col,
  row,
  rotation,
  ox = 0,
  oy = 0,
  elementId,
  label,
  labelBad = false,
  selected = false,
  moving = false,
  locked = false,
  drawOpts,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}: IsoElementProps) {
  const [sx, sy] = toScreen(col, row, ox, oy);
  return (
    <g
      data-element-id={elementId}
      className={`${s.fp} ${locked ? s.elementLocked : s.element} ${moving ? s.elementMoving : ""}`}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* 🔴 La rotación envuelve SOLO al dibujo: ver la nota de arriba. */}
      <g
        transform={rotation !== 0 ? `rotate(${rotation} ${sx} ${sy})` : undefined}
        dangerouslySetInnerHTML={{ __html: type.draw(sx, sy, drawOpts) }}
      />
      {label ? (
        <text
          x={sx + ISO_C / 2}
          y={sy - 66}
          textAnchor="middle"
          className={`${s.chairLabel} ${labelBad ? s.chairLabelBad : ""}`}
        >
          {label}
        </text>
      ) : null}
      {selected ? (
        <rect
          x={sx - 10}
          y={sy - 88}
          width={(type.w + 0.5) * ISO_C * 1.2}
          height={(type.h + 1) * ISO_C}
          rx={6}
          className={s.selection}
        />
      ) : null}
    </g>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL FANTASMA
// ═══════════════════════════════════════════════════════════════════════

/** Lo que se va a soltar, translúcido y sin capturar el ratón. */
export function IsoGhost({
  type,
  col,
  row,
  ox = 0,
  oy = 0,
}: {
  type: ElementType;
  col: number;
  row: number;
  ox?: number;
  oy?: number;
}) {
  const [sx, sy] = toScreen(col, row, ox, oy);
  return (
    <g className={`${s.fp} ${s.ghost}`} dangerouslySetInnerHTML={{ __html: type.draw(sx, sy, {}) }} />
  );
}
