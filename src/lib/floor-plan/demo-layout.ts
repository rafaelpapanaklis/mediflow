import "server-only";

import type { LayoutElement } from "./element-types";

/**
 * Layout DENTAL pre-cargado para clínicas que entran por primera vez al
 * editor. Cubre: recepción + sala de espera + 3 consultorios con sillón
 * cada uno + sala rayos X + sala esterilización + baño.
 *
 * Las posiciones (col, row) están en el grid isométrico 32×24. Los
 * sillones (type=sillon) tienen `chairLabel` que el endpoint usa para
 * crear/match con un Resource(kind=CHAIR) y luego setea su `resourceId`.
 */
export interface DemoElement extends Omit<LayoutElement, "id" | "resourceId"> {
  /** Para los 3 sillones: nombre del Resource a crear/asociar. */
  chairLabel?: string;
}

export const DEMO_ELEMENTS: DemoElement[] = [
  // ── PARED PERIMETRAL TOP ──
  { type: "wall_h", col: 0, row: 0, rotation: 0 },
  { type: "wall_h", col: 4, row: 0, rotation: 0 },
  { type: "wall_h", col: 8, row: 0, rotation: 0 },
  { type: "wall_h", col: 12, row: 0, rotation: 0 },
  { type: "wall_h", col: 16, row: 0, rotation: 0 },
  { type: "wall_h", col: 20, row: 0, rotation: 0 },
  { type: "wall_h", col: 24, row: 0, rotation: 0 },

  // ── RECEPCIÓN (top-izquierda) ──
  { type: "mostrador",   col: 1,  row: 2, rotation: 0 },
  { type: "silla_oficina", col: 2, row: 4, rotation: 0 },
  { type: "tv",          col: 9,  row: 1, rotation: 0 },

  // ── SALA DE ESPERA ──
  { type: "banca",       col: 1,  row: 6, rotation: 0 },
  { type: "banca",       col: 1,  row: 8, rotation: 0 },
  { type: "mesa_centro", col: 5,  row: 6, rotation: 0 },
  { type: "planta",      col: 8,  row: 7, rotation: 0 },
  { type: "silla_espera", col: 9, row: 8, rotation: 0 },

  // ── PASILLO HORIZONTAL (separa zonas pública/clínica) ──
  { type: "wall_h", col: 0,  row: 11, rotation: 0 },
  { type: "wall_h", col: 4,  row: 11, rotation: 0 },
  { type: "puerta", col: 8,  row: 11, rotation: 0 }, // entrada al área clínica
  { type: "wall_h", col: 10, row: 11, rotation: 0 },
  { type: "wall_h", col: 14, row: 11, rotation: 0 },
  { type: "wall_h", col: 18, row: 11, rotation: 0 },
  { type: "wall_h", col: 22, row: 11, rotation: 0 },
  { type: "wall_h", col: 26, row: 11, rotation: 0 },

  // ── CONSULTORIO 1 (cols 0-9) ──
  { type: "wall_v", col: 9,  row: 12, rotation: 0 },
  { type: "sillon",  col: 1,  row: 13, rotation: 0, chairLabel: "Consultorio 1" },
  { type: "lavabo",  col: 5,  row: 13, rotation: 0 },
  { type: "gabinete", col: 7, row: 13, rotation: 0 },
  { type: "taburete", col: 4, row: 14, rotation: 0 },

  // ── CONSULTORIO 2 (cols 10-17) ──
  { type: "wall_v",  col: 17, row: 12, rotation: 0 },
  { type: "sillon",  col: 11, row: 13, rotation: 0, chairLabel: "Consultorio 2" },
  { type: "lavabo",  col: 14, row: 13, rotation: 0 },
  { type: "taburete", col: 13, row: 15, rotation: 0 },

  // ── CONSULTORIO 3 (cols 18-25) ──
  { type: "wall_v",  col: 25, row: 12, rotation: 0 },
  { type: "sillon",  col: 19, row: 13, rotation: 0, chairLabel: "Consultorio 3" },
  { type: "rayosx",  col: 22, row: 13, rotation: 0 }, // rx en consultorio 3
  { type: "taburete", col: 21, row: 15, rotation: 0 },

  // ── SALA ESTERILIZACIÓN (cols 0-7, rows 18-21) ──
  { type: "wall_h",  col: 0,  row: 17, rotation: 0 },
  { type: "wall_h",  col: 4,  row: 17, rotation: 0 },
  { type: "esterilizador", col: 1, row: 18, rotation: 0 },
  { type: "lavabo",  col: 4,  row: 18, rotation: 0 },
  { type: "gabinete", col: 6, row: 18, rotation: 0 },

  // ── BAÑO (cols 9-12, rows 18-22) ──
  { type: "wall_v",   col: 9,  row: 18, rotation: 0 },
  { type: "puerta_bano", col: 10, row: 18, rotation: 0 },
  { type: "inodoro",  col: 10, row: 20, rotation: 0 },
  { type: "lavabo_bano", col: 11, row: 21, rotation: 0 },

  // ── OFICINA (cols 14-22, row 18-22) ──
  { type: "escritorio", col: 14, row: 18, rotation: 0 },
  { type: "silla_oficina", col: 15, row: 20, rotation: 0 },
  { type: "archivero", col: 18, row: 18, rotation: 0 },
  { type: "planta",   col: 20, row: 18, rotation: 0 },
];
