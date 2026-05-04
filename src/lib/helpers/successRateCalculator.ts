// Endodontics — métricas de tasa de éxito personal del doctor. Spec §11.3

import type {
  EndodonticTreatmentRow,
  EndodonticFollowUpRow,
} from "@/lib/types/endodontics";
import { categorizeTooth } from "./canalAnatomy";

export type SuccessKpis = {
  totalTreatments: number;
  successRate12m: number;
  successRate24m: number;
  retreatmentRate: number;
  followUpAdherence: number;
};

export type CategoryBreakdown = {
  category: "anterior" | "premolar" | "molar";
  treatments: number;
  successRate12m: number;
  successRate24m: number;
};

export type SystemBreakdown = {
  system: string;
  treatments: number;
  successRate12m: number;
};

export interface SuccessInputs {
  treatments: EndodonticTreatmentRow[];
  followUps: EndodonticFollowUpRow[];
}

/**
 * Calcula los 4 KPIs principales del dashboard. Excluye tratamientos
 * abandonados/eliminados. % se devuelve en escala 0..100.
 */
export function computeSuccessKpis(input: SuccessInputs): SuccessKpis {
  const txs = input.treatments.filter(
    (t) => t.deletedAt === null && t.outcomeStatus !== "ABANDONADO",
  );
  const totalTreatments = txs.length;

  const fuByMilestone = (m: string) =>
    input.followUps.filter(
      (f) =>
        f.milestone === m &&
        f.deletedAt === null &&
        f.performedAt !== null &&
        txs.some((t) => t.id === f.treatmentId),
    );

  const fu12 = fuByMilestone("CONTROL_12M");
  const fu24 = fuByMilestone("CONTROL_24M");

  const exito12 = fu12.filter((f) => f.conclusion === "EXITO").length;
  const exito24 = fu24.filter((f) => f.conclusion === "EXITO").length;

  const successRate12m = fu12.length === 0 ? 0 : (exito12 / fu12.length) * 100;
  const successRate24m = fu24.length === 0 ? 0 : (exito24 / fu24.length) * 100;

  const retreatments = txs.filter((t) => t.treatmentType === "RETRATAMIENTO").length;
  const retreatmentRate = totalTreatments === 0 ? 0 : (retreatments / totalTreatments) * 100;

  const allScheduled = input.followUps.filter(
    (f) => f.deletedAt === null && f.scheduledAt < new Date(),
  );
  const performed = allScheduled.filter((f) => f.performedAt !== null).length;
  const followUpAdherence = allScheduled.length === 0 ? 0 : (performed / allScheduled.length) * 100;

  return {
    totalTreatments,
    successRate12m: round1(successRate12m),
    successRate24m: round1(successRate24m),
    retreatmentRate: round1(retreatmentRate),
    followUpAdherence: round1(followUpAdherence),
  };
}

/**
 * Breakdown por categoría anatómica del diente (anterior/premolar/molar).
 * Anterior = incisor + canine; Premolar = upper + lower; Molar = upper +
 * lower + cshape.
 */
export function breakdownByToothCategory(input: SuccessInputs): CategoryBreakdown[] {
  const groups: Record<CategoryBreakdown["category"], EndodonticTreatmentRow[]> = {
    anterior: [],
    premolar: [],
    molar: [],
  };
  for (const t of input.treatments) {
    if (t.deletedAt) continue;
    const cat = categorizeTooth(t.toothFdi);
    if (cat === "incisor" || cat === "canine") groups.anterior.push(t);
    else if (cat === "premolar_upper" || cat === "premolar_lower") groups.premolar.push(t);
    else groups.molar.push(t);
  }

  return (Object.keys(groups) as Array<keyof typeof groups>).map((category) => {
    const txs = groups[category];
    const ids = new Set(txs.map((t) => t.id));
    const fu12 = input.followUps.filter(
      (f) => ids.has(f.treatmentId) && f.milestone === "CONTROL_12M" && f.performedAt && !f.deletedAt,
    );
    const fu24 = input.followUps.filter(
      (f) => ids.has(f.treatmentId) && f.milestone === "CONTROL_24M" && f.performedAt && !f.deletedAt,
    );
    const r12 = fu12.length === 0 ? 0 : (fu12.filter((f) => f.conclusion === "EXITO").length / fu12.length) * 100;
    const r24 = fu24.length === 0 ? 0 : (fu24.filter((f) => f.conclusion === "EXITO").length / fu24.length) * 100;
    return {
      category,
      treatments: txs.length,
      successRate12m: round1(r12),
      successRate24m: round1(r24),
    };
  });
}

/**
 * Breakdown por sistema de instrumentación (PROTAPER_GOLD, RECIPROC_BLUE,
 * etc.). Útil para decidir qué sistema funciona mejor en la práctica del
 * doctor.
 */
export function breakdownByInstrumentationSystem(input: SuccessInputs): SystemBreakdown[] {
  const groups: Map<string, EndodonticTreatmentRow[]> = new Map();
  for (const t of input.treatments) {
    if (t.deletedAt || !t.instrumentationSystem) continue;
    const list = groups.get(t.instrumentationSystem) ?? [];
    list.push(t);
    groups.set(t.instrumentationSystem, list);
  }
  return Array.from(groups.entries()).map(([system, txs]) => {
    const ids = new Set(txs.map((t) => t.id));
    const fu12 = input.followUps.filter(
      (f) => ids.has(f.treatmentId) && f.milestone === "CONTROL_12M" && f.performedAt && !f.deletedAt,
    );
    const r12 = fu12.length === 0 ? 0 : (fu12.filter((f) => f.conclusion === "EXITO").length / fu12.length) * 100;
    return { system, treatments: txs.length, successRate12m: round1(r12) };
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
