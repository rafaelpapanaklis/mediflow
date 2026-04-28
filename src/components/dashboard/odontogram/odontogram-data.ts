/**
 * Datos estáticos del odontograma adulto (32 dientes FDI).
 * Mapeos a Universal y Palmer.
 */

export type ToothState =
  | "SANO"
  | "CARIES"
  | "RESINA"
  | "CORONA"
  | "ENDODONCIA"
  | "IMPLANTE"
  | "AUSENTE"
  | "EXTRACCION";

export type SurfaceKey = "V" | "M" | "D" | "L" | "O";

/** Estados que se aplican a una superficie individual. */
export const SURFACE_STATES: ToothState[] = ["SANO", "CARIES", "RESINA"];

/** Estados que se aplican al diente completo. */
export const FULL_TOOTH_STATES: ToothState[] = [
  "CORONA",
  "ENDODONCIA",
  "IMPLANTE",
  "AUSENTE",
  "EXTRACCION",
];

export const STATE_LABEL: Record<ToothState, string> = {
  SANO:        "Sano",
  CARIES:      "Caries",
  RESINA:      "Restauración",
  CORONA:      "Corona",
  ENDODONCIA:  "Endodoncia",
  IMPLANTE:    "Implante",
  AUSENTE:     "Ausente",
  EXTRACCION:  "Extracción",
};

/** Paleta del mockup (mockups/audit-and-redesign/odontograma-3d.html). */
export const STATE_COLOR: Record<ToothState, string> = {
  SANO:        "#94a3b8", // slate
  CARIES:      "#dc2626", // red
  RESINA:      "#3b82f6", // blue
  CORONA:      "#d97706", // amber/orange
  ENDODONCIA:  "#7c3aed", // brand purple
  IMPLANTE:    "#059669", // green
  AUSENTE:     "#94a3b8", // slate
  EXTRACCION:  "#ef4444", // bright red
};

/** Estados ordenados para la toolbar (atajo 1-8). */
export const TOOLBAR_STATES: ToothState[] = [
  "SANO",
  "CARIES",
  "RESINA",
  "CORONA",
  "ENDODONCIA",
  "IMPLANTE",
  "AUSENTE",
  "EXTRACCION",
];

/* ─────── Notación FDI / Universal / Palmer ──────────────────── */

/** Arcada superior derecha → izquierda en orden visual (lado dx del paciente
 *  aparece a la izquierda visual). */
export const UPPER_FDI = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_FDI = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

/** Universal (US): 1-32 partiendo del 3er molar superior derecho (FDI 18). */
const FDI_TO_UNIVERSAL: Record<number, number> = {
  18: 1, 17: 2, 16: 3, 15: 4, 14: 5, 13: 6, 12: 7, 11: 8,
  21: 9, 22: 10, 23: 11, 24: 12, 25: 13, 26: 14, 27: 15, 28: 16,
  38: 17, 37: 18, 36: 19, 35: 20, 34: 21, 33: 22, 32: 23, 31: 24,
  41: 25, 42: 26, 43: 27, 44: 28, 45: 29, 46: 30, 47: 31, 48: 32,
};

/** Palmer notation: número 1-8 desde la línea media + bracket por cuadrante. */
function fdiToPalmer(fdi: number): string {
  const q = Math.floor(fdi / 10);
  const n = fdi % 10;
  if (q === 1) return `${n}┘`; // upper right
  if (q === 2) return `└${n}`; // upper left
  if (q === 3) return `┌${n}`; // lower left
  if (q === 4) return `${n}┐`; // lower right
  return String(fdi);
}

export type Notation = "FDI" | "UNIVERSAL" | "PALMER";

export function notationLabel(fdi: number, notation: Notation): string {
  if (notation === "UNIVERSAL") return String(FDI_TO_UNIVERSAL[fdi] ?? fdi);
  if (notation === "PALMER") return fdiToPalmer(fdi);
  return String(fdi);
}

/* ─────── Geometría del diente (5 superficies) ──────────────────── */

export interface SurfacePath {
  /** SVG path o rect para la superficie. */
  d?: string;
  /** Si es rect en lugar de path. */
  rect?: { x: number; y: number; w: number; h: number; rx?: number };
  /** Posición del label (centro de la superficie). */
  labelX: number;
  labelY: number;
}

/** Para diente posterior (premolar/molar): centro = O (oclusal). */
/** Para diente anterior (incisivo/canino): centro = I (incisal/oclusal en API). */
/** En ambos casos lo guardamos como "O" en la API por simplicidad. */
export interface ToothSurfaces {
  V: SurfacePath; // vestibular (top)
  L: SurfacePath; // lingual (bottom)
  M: SurfacePath; // mesial (apunta al midline)
  D: SurfacePath; // distal (apunta hacia afuera)
  O: SurfacePath; // central
}

/**
 * Geometría base de un diente en viewBox 0 0 60 60.
 * Para dientes del lado derecho (Q1 = upper-right, Q4 = lower-right) que se
 * muestran del lado izquierdo del odontograma:
 *   - Mesial apunta a la DERECHA (hacia el midline central del odontograma).
 *   - Distal apunta a la IZQUIERDA (hacia afuera).
 * Para Q2 (upper-left) y Q3 (lower-left) que se muestran del lado derecho:
 *   - Mesial apunta a la IZQUIERDA (hacia el midline).
 *   - Distal apunta a la DERECHA.
 *
 * Construimos la geometría una sola vez con M=izquierda y D=derecha y luego
 * el componente decide si swap-eamos los rótulos según la posición.
 */
export function buildToothSurfaces(mesialOnRight: boolean): ToothSurfaces {
  const left  = mesialOnRight ? "D" : "M";
  const right = mesialOnRight ? "M" : "D";
  // Trapezoides apuntando al centro + cuadrado central
  const top    = { d: "M 2 2 L 58 2 L 42 18 L 18 18 Z", labelX: 30, labelY: 13 };
  const bottom = { d: "M 58 58 L 2 58 L 18 42 L 42 42 Z", labelX: 30, labelY: 51 };
  const leftTrap  = { d: "M 2 58 L 2 2 L 18 18 L 18 42 Z", labelX: 9, labelY: 32 };
  const rightTrap = { d: "M 58 2 L 58 58 L 42 42 L 42 18 Z", labelX: 51, labelY: 32 };
  const center = { rect: { x: 18, y: 18, w: 24, h: 24, rx: 3 }, labelX: 30, labelY: 32 };
  const surfaces: ToothSurfaces = {
    V: top,
    L: bottom,
    M: leftTrap,
    D: rightTrap,
    O: center,
  };
  // Reasignamos M/D según orientación al midline
  surfaces[left as "M" | "D"] = leftTrap;
  surfaces[right as "M" | "D"] = rightTrap;
  return surfaces;
}

export function isMesialOnRight(fdi: number): boolean {
  const q = Math.floor(fdi / 10);
  return q === 1 || q === 4;
}

/** Tipo de diente para nombre clínico en tooltip. */
export function toothTypeName(fdi: number): string {
  const u = fdi % 10;
  const q = Math.floor(fdi / 10);
  const arch = q === 1 || q === 2 ? "superior" : "inferior";
  const side = q === 1 || q === 4 ? "derecho" : "izquierdo";
  if (u === 1 || u === 2) return `Incisivo ${arch} ${side}`;
  if (u === 3) return `Canino ${arch} ${side}`;
  if (u === 4 || u === 5) return `Premolar ${arch} ${side}`;
  return `Molar ${arch} ${side}`;
}

export const SURFACE_LABEL: Record<SurfaceKey, string> = {
  V: "Vestibular",
  L: "Lingual",
  M: "Mesial",
  D: "Distal",
  O: "Oclusal",
};
