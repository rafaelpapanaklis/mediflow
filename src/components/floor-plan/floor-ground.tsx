"use client";

import { memo } from "react";
import { toScreen } from "@/lib/floor-plan/iso";
import type { ElementType, LayoutElement } from "@/lib/floor-plan/element-types";
import s from "./floor-plan.module.css";

/**
 * EL SUELO COMO UN OBJETO — la losa y las sombras de contacto.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Las estrenó el editor del dental y viven aquí por la misma razón que el
 * resto de la capa: las pinta el editor del panel Y el televisor de
 * recepción, y con una copia en cada pantalla la primera vez que alguien
 * toque el zócalo se separarían.
 *
 * Como todo lo de `src/components/floor-plan/`, no conoce ni un color:
 * lee `--fp-*` de su ancestro (ver la cabecera de floor-plan.module.css).
 * Y como se dibujan DENTRO del SVG del anfitrión, llevan `.fp` en su
 * propio `<g>`: las variables heredan hacia dentro y así el dibujo tiene
 * color en cualquier pantalla, esté o no dentro de `FloorCanvasBox`.
 */

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA LOSA — el piso deja de flotar
// ═══════════════════════════════════════════════════════════════════════

/** Grosor de la losa, en píxeles de pantalla. */
const SLAB_DEPTH = 18;
/** Cuánto sobresale la losa por fuera de la rejilla, en celdas. */
const SLAB_PAD = 0.45;

/**
 * El piso como un OBJETO con grosor: la cara de arriba (un pelo más grande
 * que la rejilla) más las dos caras que se ven desde este ángulo. Sin
 * esto, las baldosas terminan en un borde de sierra contra el fondo y el
 * plano flota.
 *
 * ⚠️ Nada de `filter: drop-shadow()` aquí, que fue lo primero que se
 * probó. La losa mide unos 2 600 × 1 150 px: un filtro sobre ella obliga a
 * rasterizar esa superficie entera en cada frame del desplazamiento con la
 * mano. El zócalo cuesta tres polígonos y da MÁS sensación de volumen.
 *
 * La cara de abajo-izquierda va más oscura que la de abajo-derecha, que es
 * de dónde viene la luz en todo el catálogo isométrico (elements-dental.ts
 * pinta sus cajas con el mismo criterio).
 */
export function FloorSlab({
  ox,
  oy,
  cols,
  rows,
}: {
  ox: number;
  oy: number;
  cols: number;
  rows: number;
}) {
  const p = SLAB_PAD;
  const arriba = toScreen(-p, -p, ox, oy);
  const derecha = toScreen(cols + p, -p, ox, oy);
  const abajo = toScreen(cols + p, rows + p, ox, oy);
  const izquierda = toScreen(-p, rows + p, ox, oy);
  const baja = ([x, y]: [number, number]): [number, number] => [x, y + SLAB_DEPTH];

  const pts = (arr: Array<[number, number]>) =>
    arr.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return (
    <g className={s.fp} aria-hidden="true">
      <polygon
        className={s.slabSideLeft}
        points={pts([izquierda, abajo, baja(abajo), baja(izquierda)])}
      />
      <polygon
        className={s.slabSideRight}
        points={pts([derecha, abajo, baja(abajo), baja(derecha)])}
      />
      <polygon className={s.slabTop} points={pts([arriba, derecha, abajo, izquierda])} />
    </g>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LAS SOMBRAS DE CONTACTO
// ═══════════════════════════════════════════════════════════════════════

/** Desplazamiento de la sombra: la luz entra por arriba a la izquierda. */
const SHADOW_DX = 7;
const SHADOW_DY = 5;

/** id del desenfoque compartido. Vive aquí, junto a quien lo usa. */
const SHADOW_FILTER_ID = "fpFloorShadow";

/**
 * La huella de un mueble en el piso, ya desplazada.
 *
 * Sale de `type.w`/`type.h` (el tamaño del mueble en celdas) y no de su
 * dibujo: el catálogo devuelve cadenas SVG y no hay forma de medir su
 * silueta sin montarla. Para asentar el mueble basta la caja.
 */
function huella(
  el: LayoutElement,
  td: ElementType,
  col: number,
  row: number,
  ox: number,
  oy: number,
) {
  const [sx, sy] = toScreen(col, row, ox, oy);
  const bx = sx + SHADOW_DX;
  const by = sy + SHADOW_DY;
  const corners: Array<[number, number]> = [
    toScreen(0, 0, bx, by),
    toScreen(td.w, 0, bx, by),
    toScreen(td.w, td.h, bx, by),
    toScreen(0, td.h, bx, by),
  ];
  return (
    <polygon
      key={el.id}
      points={corners.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
      // La sombra gira con el mueble y alrededor del MISMO punto que usa
      // su dibujo; si no, a 90° la sombra se queda donde estaba.
      transform={el.rotation !== 0 ? `rotate(${el.rotation} ${sx} ${sy})` : undefined}
    />
  );
}

/**
 * Las sombras quietas: TODAS en un grupo con UN desenfoque.
 *
 * ⚠️ `memo` y `skipId` no son adorno. Un filtro SVG obliga al navegador a
 * rasterizar la caja entera del grupo —el piso completo, ~2200 × 1400—
 * cada vez que el grupo cambia. Si el mueble que se está arrastrando
 * viviera aquí dentro, ese rasterizado se repetiría en CADA frame del
 * arrastre. Así el grupo grande no cambia mientras se arrastra y la
 * sombra del que se mueve se pinta aparte, con su caja de un mueble.
 */
const StaticShadows = memo(function StaticShadows({
  elements,
  byKey,
  ox,
  oy,
  skipId,
}: {
  elements: LayoutElement[];
  byKey: Map<string, ElementType>;
  ox: number;
  oy: number;
  skipId: number | null;
}) {
  return (
    <g
      className={`${s.fp} ${s.shadowLayer}`}
      filter={`url(#${SHADOW_FILTER_ID})`}
      aria-hidden="true"
    >
      {elements.map((el) => {
        if (el.id === skipId) return null;
        const td = byKey.get(el.type);
        if (!td) return null;
        return huella(el, td, el.col, el.row, ox, oy);
      })}
    </g>
  );
});

export function FloorShadows({
  elements,
  byKey,
  ox,
  oy,
  movingId,
  movingPosition,
}: {
  elements: LayoutElement[];
  byKey: Map<string, ElementType>;
  ox: number;
  oy: number;
  movingId: number | null;
  movingPosition: { col: number; row: number } | null;
}) {
  const moving = movingId === null ? null : elements.find((e) => e.id === movingId) ?? null;
  const movingType = moving ? byKey.get(moving.type) ?? null : null;

  return (
    <>
      {/* El desenfoque vive junto a quien lo usa: `<defs>` vale en
          cualquier punto del SVG y así nadie tiene que acordarse de
          declararlo en la pantalla anfitriona. */}
      <defs>
        <filter id={SHADOW_FILTER_ID} x="-6%" y="-6%" width="112%" height="112%">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
      </defs>
      <StaticShadows elements={elements} byKey={byKey} ox={ox} oy={oy} skipId={movingId} />
      {moving && movingType && (
        <g
          className={`${s.fp} ${s.shadowLayer}`}
          filter={`url(#${SHADOW_FILTER_ID})`}
          aria-hidden="true"
        >
          {huella(
            moving,
            movingType,
            movingPosition ? movingPosition.col : moving.col,
            movingPosition ? movingPosition.row : moving.row,
            ox,
            oy,
          )}
        </g>
      )}
    </>
  );
}
