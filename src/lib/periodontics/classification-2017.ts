// Periodontics — clasificación AAP/EFP 2017 (Estadios I-IV + Grados A-C). SPEC §5.4

import type { Site, ToothLevel } from "./schemas";
import type {
  PeriodontalStage,
  PeriodontalGrade,
  PeriodontalExtension,
} from "@prisma/client";

export type ClassifyInput = {
  sites: Site[];
  toothLevel: ToothLevel[];
  patientAge: number;
  /** % pérdida ósea radiográfica (del análisis IA de PatientFile XRAY). */
  boneLossPct?: number;
  modifiers: {
    smokingCigsPerDay?: number;
    hba1c?: number;
    otherFactors?: string[];
  };
};

export type ClassifyOutput = {
  stage: PeriodontalStage;
  grade: PeriodontalGrade | null;
  extension: PeriodontalExtension | null;
  inputs: {
    maxCalInterproximalMm: number;
    maxBoneLossPct: number;
    maxPdMm: number;
    lostTeethPerio: number;
    complexityFactors: string[];
    boneLossAgeRatio: number;
    bopPct: number;
    affectedTeethPct: number;
  };
};

const INTERPROX = new Set(["MV", "DV", "MB_PAL", "DL"]);

export function classifyPerio2017(input: ClassifyInput): ClassifyOutput {
  const { sites, toothLevel, patientAge, boneLossPct, modifiers } = input;

  // CAL interproximal por sitio. CAL = PD + REC.
  const interProx = sites.filter((s) => INTERPROX.has(s.position));
  const calValues = interProx.map((s) => s.pdMm + s.recMm);
  const maxCal = calValues.length ? Math.max(0, ...calValues) : 0;

  // PD máximo
  const maxPd = sites.length ? Math.max(0, ...sites.map((s) => s.pdMm)) : 0;

  // % dientes afectados (con CAL ≥ 3 o PD ≥4 con BoP)
  const affectedFdis = new Set<number>();
  sites.forEach((s) => {
    const cal = s.pdMm + s.recMm;
    if (cal >= 3 || (s.pdMm >= 4 && s.bop)) affectedFdis.add(s.fdi);
  });
  const presentTeeth = toothLevel.filter((t) => !t.absent).length || 1;
  const affectedTeethPct = (affectedFdis.size / presentTeeth) * 100;

  // Dientes perdidos (proxy: ausentes). MVP no diferencia por causa;
  // doctor puede sobrescribir el grado si desea afinar.
  const lostTeethPerio = toothLevel.filter((t) => t.absent).length;

  // Factores de complejidad (Stage III/IV)
  const complexity: string[] = [];
  if (toothLevel.some((t) => t.mobility >= 2)) complexity.push("movilidad ≥ 2");
  if (toothLevel.some((t) => t.furcation >= 2)) complexity.push("furca II-III");
  if (maxPd >= 6) complexity.push("PD ≥ 6mm");
  if (lostTeethPerio >= 5) complexity.push("≥5 dientes perdidos");

  // BoP global
  const bopCount = sites.filter((s) => s.bop).length;
  const bopPct = (bopCount / (sites.length || 1)) * 100;

  // Stage
  let stage: PeriodontalStage;
  if (maxCal === 0 && maxPd <= 3 && bopPct < 10) {
    stage = "SALUD";
  } else if (maxCal === 0 && bopPct >= 10) {
    stage = "GINGIVITIS";
  } else if (maxCal >= 1 && maxCal <= 2) {
    stage = "STAGE_I";
  } else if (maxCal >= 3 && maxCal <= 4) {
    stage = "STAGE_II";
  } else if (maxCal >= 5 && lostTeethPerio <= 4 && complexity.length <= 2) {
    stage = "STAGE_III";
  } else if (maxCal >= 5 && (lostTeethPerio >= 5 || complexity.length >= 3)) {
    stage = "STAGE_IV";
  } else {
    stage = "STAGE_III"; // fallback razonable
  }

  // Grade
  let grade: PeriodontalGrade | null = null;
  let boneLossAgeRatio = 0;

  if (stage !== "SALUD" && stage !== "GINGIVITIS") {
    if (typeof boneLossPct === "number" && patientAge > 0) {
      boneLossAgeRatio = boneLossPct / patientAge;
      if (boneLossAgeRatio < 0.25) grade = "GRADE_A";
      else if (boneLossAgeRatio <= 1.0) grade = "GRADE_B";
      else grade = "GRADE_C";
    } else {
      // Sin radiografía: grado B por defecto (asunción conservadora)
      grade = "GRADE_B";
    }

    if (modifiers.smokingCigsPerDay && modifiers.smokingCigsPerDay >= 10) {
      grade = bumpGrade(grade);
    }
    if (modifiers.hba1c && modifiers.hba1c >= 7) {
      grade = bumpGrade(grade);
    }
  }

  // Extension
  let extension: PeriodontalExtension | null = null;
  if (stage !== "SALUD" && stage !== "GINGIVITIS") {
    const affectedArr = Array.from(affectedFdis);
    const allMolarOrIncisor = affectedArr.every((fdi) => isMolar(fdi) || isIncisor(fdi));
    const hasMolar = affectedArr.some(isMolar);
    const hasIncisor = affectedArr.some(isIncisor);

    if (allMolarOrIncisor && hasMolar && hasIncisor && affectedTeethPct < 50) {
      extension = "PATRON_MOLAR_INCISIVO";
    } else if (affectedTeethPct < 30) {
      extension = "LOCALIZADA";
    } else {
      extension = "GENERALIZADA";
    }
  }

  return {
    stage,
    grade,
    extension,
    inputs: {
      maxCalInterproximalMm: round1(maxCal),
      maxBoneLossPct: boneLossPct ?? 0,
      maxPdMm: maxPd,
      lostTeethPerio,
      complexityFactors: complexity,
      boneLossAgeRatio: round1(boneLossAgeRatio),
      bopPct: round1(bopPct),
      affectedTeethPct: round1(affectedTeethPct),
    },
  };
}

function bumpGrade(g: PeriodontalGrade): PeriodontalGrade {
  if (g === "GRADE_A") return "GRADE_B";
  if (g === "GRADE_B") return "GRADE_C";
  return "GRADE_C";
}

function isMolar(fdi: number): boolean {
  const last = fdi % 10;
  return last >= 6 && last <= 8;
}
function isIncisor(fdi: number): boolean {
  const last = fdi % 10;
  return last === 1 || last === 2;
}
const round1 = (n: number) => Math.round(n * 10) / 10;
