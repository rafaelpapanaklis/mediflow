/**
 * Isometric coordinate and drawing utilities.
 * Migrado desde mockups/clinica-visual/.../mc-iso.js — port a TypeScript.
 *
 * Convenciones:
 * - Grid 32×24 celdas. Cada celda tiene half-width C = 40 px en pantalla.
 * - "Front vertex" de la celda (col, row) es la esquina más cercana al
 *   observador. La fórmula isométrica clásica:
 *     screenX = originX + (col - row) * C
 *     screenY = originY + (col + row) * (C / 2)
 * - El origen por defecto del canvas en /dashboard/clinic-layout es
 *   (680, 260) ajustado por pan offset.
 */

/** Half-width (en píxeles) de una celda del grid isométrico. */
export const C = 40;

export interface Point2D {
  x: number;
  y: number;
}

/**
 * EL `viewBox` QUE HACE FALTA PARA QUE NO SE CORTE NADA.
 *
 * 🔴 El plano se pintaba en un `viewBox="0 0 1920 1080"` escrito a mano, y
 * la rejilla NO CABE AHI. Con el origen en (680, 260), C = 40 y una rejilla
 * de 32x24, el rombo del piso va de x = -280 a x = 1960 y de y = 260 a
 * **y = 1380**: sobresale 300 px por abajo y otros tantos por los lados.
 * Todo lo que cae en las ultimas filas —el fondo de la clinica, y con el el
 * ultimo consultorio— quedaba fuera del recorte y no habia zoom que lo
 * trajera de vuelta, porque el recorte es del SVG, no de la camara.
 *
 * Se calcula en vez de escribirse para que mover el origen o cambiar el
 * tamano de la rejilla no vuelva a dejar medio piso fuera.
 *
 * `alturaMax` es cuanto suben los muebles por encima del vertice frontal de
 * su celda (las cajas isometricas se dibujan hacia ARRIBA), y el margen
 * cubre la losa, que sobresale un poco de la rejilla.
 */
export function isoViewBox(
  cols: number,
  rows: number,
  ox: number,
  oy: number,
  alturaMax = 160,
  margen = 48,
): string {
  const minX = ox - rows * C - margen;
  const maxX = ox + cols * C + margen;
  const minY = oy - alturaMax - margen;
  const maxY = oy + ((cols + rows) * C) / 2 + margen;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

export interface BoxColors {
  top?: string;
  left?: string;
  right?: string;
  stroke?: string | null;
  /** stroke-width */
  sw?: number;
}

/** Grid → screen: vértice frontal de la celda (col, row). */
export function toScreen(col: number, row: number, ox = 0, oy = 0): [number, number] {
  return [ox + (col - row) * C, oy + (col + row) * (C / 2)];
}

/** Screen → grid (fraccional; el caller decide round/snap). */
export function fromScreen(sx: number, sy: number, ox = 0, oy = 0): [number, number] {
  const dx = sx - ox;
  const dy = sy - oy;
  return [(dx + 2 * dy) / (2 * C), (2 * dy - dx) / (2 * C)];
}

/** Formatea array de puntos `[[x,y], ...]` a string SVG `points`. */
export function pts(arr: Array<[number, number]>): string {
  return arr.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
}

/**
 * Dibuja una caja isométrica como 3 polígonos SVG (cara superior, izquierda
 * y derecha). Devuelve un fragmento HTML/SVG embebible.
 *
 * @param ox/oy   Posición en pantalla del vértice frontal (col=0, row=0).
 * @param cw      Ancho en unidades de columna del grid.
 * @param rh      Profundidad en unidades de fila del grid.
 * @param ph      Altura de la caja en píxeles.
 * @param colors  Colores opcionales { top, left, right, stroke, sw }.
 */
export function box(
  ox: number,
  oy: number,
  cw: number,
  rh: number,
  ph: number,
  colors?: BoxColors,
): string {
  const o = colors ?? {};
  const top = o.top ?? "#ffffff";
  const left = o.left ?? "#bbbbbb";
  const right = o.right ?? "#dddddd";
  const stroke = o.stroke !== undefined ? o.stroke : "rgba(0,0,0,0.07)";
  const sw = o.sw ?? 0.5;

  const g = (c: number, r: number): [number, number] => [
    ox + (c - r) * C,
    oy + (c + r) * (C / 2),
  ];

  const A = g(0, 0);
  const B = g(cw, 0);
  const Cc = g(cw, rh);
  const D = g(0, rh);
  const up = (p: [number, number]): [number, number] => [p[0], p[1] - ph];
  const Au = up(A);
  const Bu = up(B);
  const Cu = up(Cc);
  const Du = up(D);

  const s = stroke ? `stroke="${stroke}" stroke-width="${sw}"` : "";

  return (
    `<polygon points="${pts([A, B, Bu, Au])}" fill="${right}" ${s}/>` +
    `<polygon points="${pts([A, Au, Du, D])}" fill="${left}" ${s}/>` +
    `<polygon points="${pts([Au, Bu, Cu, Du])}" fill="${top}" ${s}/>`
  );
}

/** Dibuja un diamante isométrico plano (cara superior solamente / floor tile). */
export function flat(
  ox: number,
  oy: number,
  cw: number,
  rh: number,
  fill = "#e8f4f8",
  stroke: string | null = null,
): string {
  const g = (c: number, r: number): [number, number] => [
    ox + (c - r) * C,
    oy + (c + r) * (C / 2),
  ];
  const A = g(0, 0);
  const B = g(cw, 0);
  const Cc = g(cw, rh);
  const D = g(0, rh);
  const s = stroke ? `stroke="${stroke}" stroke-width="0.5"` : "";
  return `<polygon points="${pts([A, B, Cc, D])}" fill="${fill}" ${s}/>`;
}

/** Snap fraccional a entero. */
export function snap(n: number): number {
  return Math.round(n);
}

/** Dado un evento mouse en el SVG, devuelve coords (col, row) snapped a grid. */
export function mouseToGrid(
  clientX: number,
  clientY: number,
  svgRect: DOMRect,
  origin: Point2D,
  panOffset: Point2D,
  zoom: number,
): { col: number; row: number; colExact: number; rowExact: number } {
  const sx = (clientX - svgRect.left) / zoom - panOffset.x;
  const sy = (clientY - svgRect.top) / zoom - panOffset.y;
  const [col, row] = fromScreen(sx, sy, origin.x, origin.y);
  return {
    col: snap(col),
    row: snap(row),
    colExact: col,
    rowExact: row,
  };
}
