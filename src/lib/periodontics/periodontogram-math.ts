// Periodontics — cálculo de métricas del periodontograma. SPEC §5.4

import type { Site, ToothLevel } from "./schemas";

export type PerioMetrics = {
  bopPct: number;
  plaquePct: number;
  sites1to3: number;
  sites4to5: number;
  sites6plus: number;
  teethWithPockets5plus: number;
  totalSites: number;
  avgPd: number;
};

/**
 * Calcula las métricas que se muestran en `<LiveIndicators />` y se
 * persisten en `PeriodontalRecord` cuando se finaliza el sondaje.
 * Excluye sitios de dientes ausentes para no inflar el denominador.
 */
export function computePerioMetrics(sites: Site[], teeth: ToothLevel[]): PerioMetrics {
  const present = sites.filter((s) => {
    const t = teeth.find((tt) => tt.fdi === s.fdi);
    return !t || !t.absent;
  });
  const total = present.length || 1;

  const bopCount = present.filter((s) => s.bop).length;
  const plaqueCount = present.filter((s) => s.plaque).length;
  const s1to3 = present.filter((s) => s.pdMm >= 1 && s.pdMm <= 3).length;
  const s4to5 = present.filter((s) => s.pdMm >= 4 && s.pdMm <= 5).length;
  const s6plus = present.filter((s) => s.pdMm >= 6).length;

  // Dientes con al menos 1 sitio ≥5mm.
  const fdisWithPockets5 = new Set(present.filter((s) => s.pdMm >= 5).map((s) => s.fdi));

  return {
    bopPct: round1((bopCount / total) * 100),
    plaquePct: round1((plaqueCount / total) * 100),
    sites1to3: s1to3,
    sites4to5: s4to5,
    sites6plus: s6plus,
    teethWithPockets5plus: fdisWithPockets5.size,
    totalSites: total,
    avgPd: round1(present.reduce((acc, s) => acc + s.pdMm, 0) / total),
  };
}

/** PD promedio (sin filtrar). */
export function avgPd(sites: Site[]): number {
  if (!sites.length) return 0;
  return round1(sites.reduce((acc, s) => acc + s.pdMm, 0) / sites.length);
}

/** CAL (Clinical Attachment Loss) por sitio = PD + REC. */
export function calMm(site: Site): number {
  return site.pdMm + site.recMm;
}

/** Severidad PD para coloreado de la celda (verde/amarillo/rojo). SPEC §1.9. */
export function pdSeverity(pdMm: number): "green" | "yellow" | "red" {
  if (pdMm <= 3) return "green";
  if (pdMm <= 5) return "yellow";
  return "red";
}

/**
 * Compara dos sondajes (initial vs post) para reevaluación post-Fase 2.
 * Devuelve mejoras y sitios residuales con BoP+PD≥5.
 */
export function compareRecords(
  initial: { sites: Site[]; teeth: ToothLevel[] },
  post: { sites: Site[]; teeth: ToothLevel[] },
): {
  bopImprovementPct: number;
  pdAverageImprovementMm: number;
  residualSites: Array<{ fdi: number; position: Site["position"]; pdMm: number; bop: true }>;
} {
  const mInit = computePerioMetrics(initial.sites, initial.teeth);
  const mPost = computePerioMetrics(post.sites, post.teeth);
  const residualSites = post.sites
    .filter((s) => s.pdMm >= 5 && s.bop)
    .map((s) => ({ fdi: s.fdi, position: s.position, pdMm: s.pdMm, bop: true as const }));
  return {
    bopImprovementPct: round1(mInit.bopPct - mPost.bopPct),
    pdAverageImprovementMm: round1(mInit.avgPd - mPost.avgPd),
    residualSites,
  };
}

/**
 * Stub que en v1.1 leerá de `XrayAnalysis` el % de pérdida ósea
 * radiográfica detectado por IA. En MVP devuelve undefined y
 * `classifyPerio2017` cae al default GRADE_B (asunción conservadora
 * según SPEC §5.4).
 *
 * TODO v1.1: implementar modo PERIODONTAL_BONE_LOSS en XrayAnalysis y
 * leer del último análisis de panorámica/periapical del paciente.
 */
export async function getRadiographicBoneLossPct(
  _patientId: string,
): Promise<number | undefined> {
  return undefined;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
