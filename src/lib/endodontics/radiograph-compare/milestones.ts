// Endodontics — comparativo radiográfico: hitos canónicos para
// mostrar pre-TC / post-TC inmediato / control 6m / 12m / 24m.
// Fuente: PatientFile referenciada vía RootCanal.conductometryFile +
// EndodonticFollowUp.controlFile + ApicalSurgery.intraoperativeFile.

export type RadiographMilestone =
  | "pre_tc"
  | "post_tc_immediate"
  | "control_6m"
  | "control_12m"
  | "control_24m";

export const RADIOGRAPH_MILESTONES: readonly RadiographMilestone[] = [
  "pre_tc",
  "post_tc_immediate",
  "control_6m",
  "control_12m",
  "control_24m",
];

export const RADIOGRAPH_MILESTONE_LABEL: Record<RadiographMilestone, string> = {
  pre_tc: "Pre-TC",
  post_tc_immediate: "Post-TC inmediato",
  control_6m: "Control 6 meses",
  control_12m: "Control 12 meses",
  control_24m: "Control 24 meses",
};

export interface RadiographEntry {
  id: string;
  fileUrl: string;
  takenAt: string | Date;
  milestone: RadiographMilestone;
  /** PAI score si fue detectado por XrayAnalysis (mode futuro PERIAPICAL_PAI). */
  detectedPaiScore?: number | null;
  /** PAI score capturado manualmente por el doctor. Tiene prioridad sobre detectado. */
  manualPaiScore?: number | null;
  caption?: string | null;
}

/**
 * Mapea el milestone del EndodonticFollowUp (CONTROL_6M/12M/24M) al
 * milestone del comparativo. CONTROL_EXTRA cae a control_24m por
 * proximidad temporal.
 */
export function followUpMilestoneToRadiograph(
  milestone: string,
): RadiographMilestone | null {
  switch (milestone) {
    case "CONTROL_6M":
      return "control_6m";
    case "CONTROL_12M":
      return "control_12m";
    case "CONTROL_24M":
    case "CONTROL_EXTRA":
      return "control_24m";
    default:
      return null;
  }
}

/** PAI efectivo: manual > detectado > null. */
export function effectivePaiScore(entry: RadiographEntry): number | null {
  if (entry.manualPaiScore !== undefined && entry.manualPaiScore !== null) {
    return entry.manualPaiScore;
  }
  if (entry.detectedPaiScore !== undefined && entry.detectedPaiScore !== null) {
    return entry.detectedPaiScore;
  }
  return null;
}

/** Diff de PAI: positivo = mejoría (PAI menor), negativo = empeoramiento. */
export function paiDelta(left: RadiographEntry, right: RadiographEntry): number | null {
  const a = effectivePaiScore(left);
  const b = effectivePaiScore(right);
  if (a === null || b === null) return null;
  return a - b;
}

export function describePaiDelta(delta: number | null): string {
  if (delta === null) return "Sin PAI registrado";
  if (delta === 0) return "PAI estable";
  if (delta > 0) return `Mejora de ${delta} punto${delta === 1 ? "" : "s"} en PAI`;
  return `Empeoramiento de ${Math.abs(delta)} punto${delta === -1 ? "" : "s"} en PAI`;
}

/** Lista de hitos disponibles en el set de entries (en orden canónico). */
export function availableMilestones(entries: RadiographEntry[]): RadiographMilestone[] {
  const seen = new Set<RadiographMilestone>();
  for (const e of entries) seen.add(e.milestone);
  return RADIOGRAPH_MILESTONES.filter((m) => seen.has(m));
}

export function describePAI(pai: number | null): string {
  if (pai === null || pai === undefined) return "—";
  const map: Record<number, string> = {
    1: "PAI 1 — Estructuras periapicales normales",
    2: "PAI 2 — Pequeños cambios óseos",
    3: "PAI 3 — Cambios óseos con pérdida mineral",
    4: "PAI 4 — Periodontitis apical bien definida",
    5: "PAI 5 — Periodontitis apical severa con expansión",
  };
  return map[pai] ?? `PAI ${pai}`;
}
