// Periodontics — Riesgo de progresión Berna (Lang & Tonetti). SPEC §5.4

import type { PeriodontalRiskCategory, SmokingStatus } from "@prisma/client";

export type RiskInput = {
  bopPct: number;
  residualSites5Plus: number;
  lostTeethPerio: number;
  /** Pérdida ósea (%) / edad. Opcional — sin radiografía no aporta. */
  boneLossAgeRatio?: number;
  smokingStatus: SmokingStatus;
  hba1c?: number;
};

export type RiskFactor = {
  name: string;
  level: "BAJO" | "MODERADO" | "ALTO";
  weight: 1 | 2 | 3;
};

export type RiskOutput = {
  riskCategory: PeriodontalRiskCategory;
  recommendedRecallMonths: 3 | 4 | 6;
  factors: RiskFactor[];
};

/**
 * Cada factor aporta un nivel; el peor de los 6 manda la categoría final.
 * Recall: BAJO=6m, MODERADO=4m, ALTO=3m.
 *
 * Factores ausentes (boneLossAgeRatio/hba1c sin valor) no se incluyen,
 * para no contaminar el cálculo final con datos que no se midieron.
 */
export function computeBernaRisk(input: RiskInput): RiskOutput {
  const factors: RiskFactor[] = [];

  // 1. BoP%
  if (input.bopPct < 10) factors.push({ name: "BoP %", level: "BAJO", weight: 1 });
  else if (input.bopPct < 25) factors.push({ name: "BoP %", level: "MODERADO", weight: 2 });
  else factors.push({ name: "BoP %", level: "ALTO", weight: 3 });

  // 2. Sitios residuales ≥ 5mm
  if (input.residualSites5Plus <= 4) factors.push({ name: "Sitios residuales ≥5mm", level: "BAJO", weight: 1 });
  else if (input.residualSites5Plus <= 8) factors.push({ name: "Sitios residuales ≥5mm", level: "MODERADO", weight: 2 });
  else factors.push({ name: "Sitios residuales ≥5mm", level: "ALTO", weight: 3 });

  // 3. Dientes perdidos por causa periodontal
  if (input.lostTeethPerio <= 4) factors.push({ name: "Dientes perdidos", level: "BAJO", weight: 1 });
  else if (input.lostTeethPerio <= 8) factors.push({ name: "Dientes perdidos", level: "MODERADO", weight: 2 });
  else factors.push({ name: "Dientes perdidos", level: "ALTO", weight: 3 });

  // 4. Pérdida ósea / edad — opcional
  if (input.boneLossAgeRatio !== undefined) {
    if (input.boneLossAgeRatio < 0.25) factors.push({ name: "BL/edad", level: "BAJO", weight: 1 });
    else if (input.boneLossAgeRatio <= 1.0) factors.push({ name: "BL/edad", level: "MODERADO", weight: 2 });
    else factors.push({ name: "BL/edad", level: "ALTO", weight: 3 });
  }

  // 5. Tabaquismo
  if (input.smokingStatus === "NO") factors.push({ name: "Tabaco", level: "BAJO", weight: 1 });
  else if (input.smokingStatus === "MENOR_10") factors.push({ name: "Tabaco", level: "MODERADO", weight: 2 });
  else factors.push({ name: "Tabaco", level: "ALTO", weight: 3 });

  // 6. HbA1c — opcional
  if (input.hba1c !== undefined) {
    if (input.hba1c < 6.5) factors.push({ name: "HbA1c", level: "BAJO", weight: 1 });
    else if (input.hba1c < 7.5) factors.push({ name: "HbA1c", level: "MODERADO", weight: 2 });
    else factors.push({ name: "HbA1c", level: "ALTO", weight: 3 });
  }

  const maxWeight = Math.max(...factors.map((f) => f.weight));
  const riskCategory: PeriodontalRiskCategory =
    maxWeight === 1 ? "BAJO" : maxWeight === 2 ? "MODERADO" : "ALTO";
  const recommendedRecallMonths = (riskCategory === "BAJO" ? 6 : riskCategory === "MODERADO" ? 4 : 3) as
    | 3
    | 4
    | 6;

  return { riskCategory, recommendedRecallMonths, factors };
}
