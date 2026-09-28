// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, sep-2026). H9/H10:
// análisis de Bolton y de espacio a partir de anchos mesiodistales medidos
// manualmente (con la regla del visor 3D existente, o un calibre físico).
// No depende de integrar el marcado dentro de Model3DViewer.tsx — eso
// queda documentado como trabajo futuro (ver `docs`) para no arriesgar ese
// componente, que ya funciona (H9 "verlo desde el caso"). Puro — sin Prisma.

export type ToothWidths = Partial<Record<number, number>>; // FDI → mm mesiodistal

const MAX_ANTERIOR = [13, 12, 11, 21, 22, 23];
const MAND_ANTERIOR = [43, 42, 41, 31, 32, 33];
const MAX_ALL_12 = [16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26];
const MAND_ALL_12 = [46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36];

// Proporciones ideales publicadas por Bolton (1958).
export const BOLTON_ANTERIOR_IDEAL = 77.2;
export const BOLTON_OVERALL_IDEAL = 91.3;

function sumWidths(widths: ToothWidths, teeth: number[]): { total: number; missing: number[] } {
  let total = 0;
  const missing: number[] = [];
  for (const fdi of teeth) {
    const w = widths[fdi];
    if (typeof w === "number" && w > 0) total += w;
    else missing.push(fdi);
  }
  return { total: round2(total), missing };
}

export interface BoltonResult {
  anteriorRatio: number | null;
  anteriorIdeal: number;
  /** mm que sobran (+) o faltan (-) en la mandíbula para llegar a la proporción ideal. */
  anteriorDiscrepancyMm: number | null;
  overallRatio: number | null;
  overallIdeal: number;
  overallDiscrepancyMm: number | null;
  missingTeeth: number[];
}

/** Análisis de Bolton anterior (6x6) y total (12x12). null si faltan anchos. */
export function computeBolton(widths: ToothWidths): BoltonResult {
  const maxA = sumWidths(widths, MAX_ANTERIOR);
  const mandA = sumWidths(widths, MAND_ANTERIOR);
  const maxAll = sumWidths(widths, MAX_ALL_12);
  const mandAll = sumWidths(widths, MAND_ALL_12);

  const missingTeeth = Array.from(
    new Set([...maxA.missing, ...mandA.missing, ...maxAll.missing, ...mandAll.missing]),
  ).sort((a, b) => a - b);

  const anteriorRatio =
    maxA.missing.length === 0 && mandA.missing.length === 0 && maxA.total > 0
      ? round1((mandA.total / maxA.total) * 100)
      : null;
  const overallRatio =
    maxAll.missing.length === 0 && mandAll.missing.length === 0 && maxAll.total > 0
      ? round1((mandAll.total / maxAll.total) * 100)
      : null;

  const anteriorDiscrepancyMm =
    anteriorRatio !== null ? round2(mandA.total - (maxA.total * BOLTON_ANTERIOR_IDEAL) / 100) : null;
  const overallDiscrepancyMm =
    overallRatio !== null ? round2(mandAll.total - (maxAll.total * BOLTON_OVERALL_IDEAL) / 100) : null;

  return {
    anteriorRatio,
    anteriorIdeal: BOLTON_ANTERIOR_IDEAL,
    anteriorDiscrepancyMm,
    overallRatio,
    overallIdeal: BOLTON_OVERALL_IDEAL,
    overallDiscrepancyMm,
    missingTeeth,
  };
}

export interface ArchSpaceResult {
  requiredMm: number;
  availableMm: number;
  /** Negativo = apiñamiento (falta espacio); positivo = espaciado. */
  discrepancyMm: number;
  missingTeeth: number[];
}

/** Espacio disponible del arco vs suma de anchos de los dientes que debe alojar. */
export function computeArchSpaceDiscrepancy(
  availableMm: number,
  widths: ToothWidths,
  teeth: number[],
): ArchSpaceResult {
  const { total, missing } = sumWidths(widths, teeth);
  return {
    requiredMm: total,
    availableMm: round2(availableMm),
    discrepancyMm: round2(availableMm - total),
    missingTeeth: missing,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
