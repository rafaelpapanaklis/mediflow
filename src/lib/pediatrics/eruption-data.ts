// Pediatrics — tabla OMS/ADA de rangos de erupción para 52 dientes. Spec: §1.9, §4.A.1

export type EruptionPosition =
  | "central"
  | "lateral"
  | "canine"
  | "molar1"
  | "molar2"
  | "premolar1"
  | "premolar2"
  | "molar3";

export type EruptionRange = {
  fdi: number;
  type: "temporal" | "permanent";
  minMonths: number;
  maxMonths: number;
  meanMonths: number;
  arch: "upper" | "lower";
  position: EruptionPosition;
};

function tempUpper(fdi: number, position: EruptionPosition, min: number, max: number): EruptionRange {
  return {
    fdi,
    type: "temporal",
    minMonths: min,
    maxMonths: max,
    meanMonths: Math.round((min + max) / 2),
    arch: "upper",
    position,
  };
}
function tempLower(fdi: number, position: EruptionPosition, min: number, max: number): EruptionRange {
  return {
    fdi,
    type: "temporal",
    minMonths: min,
    maxMonths: max,
    meanMonths: Math.round((min + max) / 2),
    arch: "lower",
    position,
  };
}
function permUpper(fdi: number, position: EruptionPosition, minYears: number, maxYears: number): EruptionRange {
  return {
    fdi,
    type: "permanent",
    minMonths: minYears * 12,
    maxMonths: maxYears * 12,
    meanMonths: Math.round(((minYears + maxYears) / 2) * 12),
    arch: "upper",
    position,
  };
}
function permLower(fdi: number, position: EruptionPosition, minYears: number, maxYears: number): EruptionRange {
  return {
    fdi,
    type: "permanent",
    minMonths: minYears * 12,
    maxMonths: maxYears * 12,
    meanMonths: Math.round(((minYears + maxYears) / 2) * 12),
    arch: "lower",
    position,
  };
}

/**
 * 52 dientes (20 temporales + 32 permanentes). Rangos OMS/ADA típicos
 * documentados en literatura odontopediátrica estándar. Los terceros
 * molares (18,28,38,48) usan rango amplio 17-25 años por alta variabilidad.
 */
export const ERUPTION_TABLE: EruptionRange[] = [
  // Temporales — superior derecho (51-55)
  tempUpper(51, "central", 8, 12),
  tempUpper(52, "lateral", 9, 13),
  tempUpper(53, "canine", 16, 22),
  tempUpper(54, "molar1", 13, 19),
  tempUpper(55, "molar2", 25, 33),
  // Temporales — superior izquierdo (61-65)
  tempUpper(61, "central", 8, 12),
  tempUpper(62, "lateral", 9, 13),
  tempUpper(63, "canine", 16, 22),
  tempUpper(64, "molar1", 13, 19),
  tempUpper(65, "molar2", 25, 33),
  // Temporales — inferior izquierdo (71-75)
  tempLower(71, "central", 6, 10),
  tempLower(72, "lateral", 10, 16),
  tempLower(73, "canine", 17, 23),
  tempLower(74, "molar1", 14, 18),
  tempLower(75, "molar2", 23, 31),
  // Temporales — inferior derecho (81-85)
  tempLower(81, "central", 6, 10),
  tempLower(82, "lateral", 10, 16),
  tempLower(83, "canine", 17, 23),
  tempLower(84, "molar1", 14, 18),
  tempLower(85, "molar2", 23, 31),

  // Permanentes — superior derecho (11-18)
  permUpper(11, "central", 7, 8),
  permUpper(12, "lateral", 8, 9),
  permUpper(13, "canine", 11, 12),
  permUpper(14, "premolar1", 10, 11),
  permUpper(15, "premolar2", 10, 12),
  permUpper(16, "molar1", 6, 7),
  permUpper(17, "molar2", 12, 13),
  permUpper(18, "molar3", 17, 25),
  // Permanentes — superior izquierdo (21-28)
  permUpper(21, "central", 7, 8),
  permUpper(22, "lateral", 8, 9),
  permUpper(23, "canine", 11, 12),
  permUpper(24, "premolar1", 10, 11),
  permUpper(25, "premolar2", 10, 12),
  permUpper(26, "molar1", 6, 7),
  permUpper(27, "molar2", 12, 13),
  permUpper(28, "molar3", 17, 25),
  // Permanentes — inferior izquierdo (31-38)
  permLower(31, "central", 6, 7),
  permLower(32, "lateral", 7, 8),
  permLower(33, "canine", 9, 10),
  permLower(34, "premolar1", 10, 12),
  permLower(35, "premolar2", 11, 12),
  permLower(36, "molar1", 6, 7),
  permLower(37, "molar2", 11, 13),
  permLower(38, "molar3", 17, 25),
  // Permanentes — inferior derecho (41-48)
  permLower(41, "central", 6, 7),
  permLower(42, "lateral", 7, 8),
  permLower(43, "canine", 9, 10),
  permLower(44, "premolar1", 10, 12),
  permLower(45, "premolar2", 11, 12),
  permLower(46, "molar1", 6, 7),
  permLower(47, "molar2", 11, 13),
  permLower(48, "molar3", 17, 25),
];

const FDI_INDEX: ReadonlyMap<number, EruptionRange> = new Map(
  ERUPTION_TABLE.map((r) => [r.fdi, r] as const),
);

export function getRangeForFdi(fdi: number): EruptionRange | null {
  return FDI_INDEX.get(fdi) ?? null;
}

/**
 * Clasifica una erupción observada respecto a su rango esperado:
 * - within: dentro del rango.
 * - mild: ±6 meses fuera del rango.
 * - early: erupcionó antes del rango con desviación >6 meses.
 * - pathological: >12 meses fuera del rango (cualquier dirección).
 */
export function evaluateDeviation(
  actualMonths: number,
  range: EruptionRange,
): "within" | "mild" | "early" | "pathological" {
  if (actualMonths >= range.minMonths && actualMonths <= range.maxMonths) return "within";
  const delta =
    actualMonths < range.minMonths
      ? range.minMonths - actualMonths
      : actualMonths - range.maxMonths;
  if (delta > 12) return "pathological";
  if (actualMonths < range.minMonths) return "early";
  return "mild";
}
