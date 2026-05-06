// Periodontics — sextantes (CPITN) y agregación de métricas por sextante.
// SPEC §6 visual comparativo, COMMIT 10.

import type { Site, ToothLevel } from "./schemas";

export type Sextant = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";

export const SEXTANT_ORDER: ReadonlyArray<Sextant> = ["S1", "S2", "S3", "S4", "S5", "S6"];

export const SEXTANT_LABEL: Record<Sextant, string> = {
  S1: "Superior derecho posterior",
  S2: "Superior anterior",
  S3: "Superior izquierdo posterior",
  S4: "Inferior izquierdo posterior",
  S5: "Inferior anterior",
  S6: "Inferior derecho posterior",
};

/**
 * Mapeo CPITN. FDIs ausentes o terceros molares pueden o no estar en el
 * sondaje; el caller filtra por presencia.
 */
export const SEXTANT_FDIS: Record<Sextant, ReadonlyArray<number>> = {
  S1: [18, 17, 16, 15, 14],
  S2: [13, 12, 11, 21, 22, 23],
  S3: [24, 25, 26, 27, 28],
  S4: [38, 37, 36, 35, 34],
  S5: [33, 32, 31, 41, 42, 43],
  S6: [44, 45, 46, 47, 48],
};

const FDI_TO_SEXTANT: Map<number, Sextant> = new Map();
for (const [sx, fdis] of Object.entries(SEXTANT_FDIS) as Array<[Sextant, number[]]>) {
  for (const fdi of fdis) FDI_TO_SEXTANT.set(fdi, sx);
}

export function fdiToSextant(fdi: number): Sextant | null {
  return FDI_TO_SEXTANT.get(fdi) ?? null;
}

export interface SextantMetrics {
  sextant: Sextant;
  /** Cantidad de sitios presentes (no ausentes) en el sextante. */
  totalSites: number;
  /** PD promedio en mm. 0 si no hay sitios. */
  avgPd: number;
  /** % BoP en el sextante. 0 si no hay sitios. */
  bopPct: number;
  /** Sitios con PD ≥5 + BoP+ (residuales clínicamente). */
  residualSites: number;
  /** Diente ausente cuenta como "sin sitios" — el sextante puede salir 0/0. */
  hasAnyTooth: boolean;
}

/**
 * Agrega métricas perio por sextante. Excluye sitios cuyo diente está
 * marcado `absent` en `teeth`. Útil para heatmap comparativo.
 */
export function computeSextantMetrics(
  sites: Site[],
  teeth: ToothLevel[],
): SextantMetrics[] {
  const absentSet = new Set(teeth.filter((t) => t.absent).map((t) => t.fdi));

  const buckets: Record<Sextant, Site[]> = {
    S1: [], S2: [], S3: [], S4: [], S5: [], S6: [],
  };
  const presentTeeth: Record<Sextant, Set<number>> = {
    S1: new Set(), S2: new Set(), S3: new Set(),
    S4: new Set(), S5: new Set(), S6: new Set(),
  };

  for (const s of sites) {
    if (absentSet.has(s.fdi)) continue;
    const sx = fdiToSextant(s.fdi);
    if (!sx) continue;
    buckets[sx].push(s);
    presentTeeth[sx].add(s.fdi);
  }

  return SEXTANT_ORDER.map((sx) => {
    const ss = buckets[sx];
    const total = ss.length;
    if (total === 0) {
      return {
        sextant: sx,
        totalSites: 0,
        avgPd: 0,
        bopPct: 0,
        residualSites: 0,
        hasAnyTooth: presentTeeth[sx].size > 0,
      };
    }
    const bop = ss.filter((s) => s.bop).length;
    const residual = ss.filter((s) => s.pdMm >= 5 && s.bop).length;
    const avg = ss.reduce((acc, s) => acc + s.pdMm, 0) / total;
    return {
      sextant: sx,
      totalSites: total,
      avgPd: round1(avg),
      bopPct: round1((bop / total) * 100),
      residualSites: residual,
      hasAnyTooth: true,
    };
  });
}

export interface SextantDelta {
  sextant: Sextant;
  /** Mejora PD promedio (initial - post). Positivo = mejoró. */
  avgPdDelta: number;
  /** Mejora BoP. Positivo = mejoró. */
  bopPctDelta: number;
  residualSitesDelta: number;
  /** Categoría visual sugerida para heatmap. */
  trend: "improved" | "stable" | "worsened" | "no_data";
}

/**
 * Compara dos snapshots de sextantes (post - initial) y devuelve deltas
 * con clasificación visual para heatmap.
 *
 * Umbral de "stable": cambios menores a 0.3 mm en PD o 5 puntos en BoP%.
 */
export function diffSextants(
  initial: SextantMetrics[],
  post: SextantMetrics[],
): SextantDelta[] {
  const initMap = new Map(initial.map((m) => [m.sextant, m]));
  return post.map((p) => {
    const i = initMap.get(p.sextant);
    if (!i || (!i.hasAnyTooth && !p.hasAnyTooth)) {
      return {
        sextant: p.sextant,
        avgPdDelta: 0,
        bopPctDelta: 0,
        residualSitesDelta: 0,
        trend: "no_data" as const,
      };
    }
    const avgPdDelta = round1(i.avgPd - p.avgPd);
    const bopPctDelta = round1(i.bopPct - p.bopPct);
    const residualDelta = i.residualSites - p.residualSites;
    const trend = classifyTrend(avgPdDelta, bopPctDelta);
    return {
      sextant: p.sextant,
      avgPdDelta,
      bopPctDelta,
      residualSitesDelta: residualDelta,
      trend,
    };
  });
}

function classifyTrend(
  avgPdDelta: number,
  bopPctDelta: number,
): SextantDelta["trend"] {
  // Mejora clara si PD bajó ≥0.3mm O BoP bajó ≥5%.
  const improved = avgPdDelta >= 0.3 || bopPctDelta >= 5;
  // Empeoramiento si PD subió ≥0.3 O BoP subió ≥5.
  const worsened = avgPdDelta <= -0.3 || bopPctDelta <= -5;
  if (improved && !worsened) return "improved";
  if (worsened && !improved) return "worsened";
  return "stable";
}

const round1 = (n: number) => Math.round(n * 10) / 10;
