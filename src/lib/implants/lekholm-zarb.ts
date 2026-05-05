// Implants — densidad ósea Lekholm-Zarb 1985 (D1-D4).
// NO mezclar con clasificación Misch. Spec §1.12, §17.

import type { LekholmZarbDensity } from "@prisma/client";

export type LekholmZarbInfo = {
  density: LekholmZarbDensity;
  description: string;
  typicalLocation: string;
  drillingProtocol: string;
  expectedTorqueRangeNcm: { min: number; max: number };
  expectedHealingWeeks: { min: number; typical: number };
};

export const LEKHOLM_ZARB_INFO: Readonly<Record<LekholmZarbDensity, LekholmZarbInfo>> = {
  D1: {
    density: "D1",
    description: "Cortical densa, esponjosa mínima",
    typicalLocation: "Mandíbula anterior atrófica",
    drillingProtocol: "Tap obligatorio",
    expectedTorqueRangeNcm: { min: 40, max: 60 },
    expectedHealingWeeks: { min: 8, typical: 10 },
  },
  D2: {
    density: "D2",
    description: "Cortical gruesa rodeando esponjosa densa",
    typicalLocation: "Mandíbula anterior y posterior, maxilar anterior",
    drillingProtocol: "Estándar",
    expectedTorqueRangeNcm: { min: 35, max: 50 },
    expectedHealingWeeks: { min: 6, typical: 8 },
  },
  D3: {
    density: "D3",
    description: "Cortical fina rodeando esponjosa de baja densidad",
    typicalLocation: "Maxilar posterior",
    drillingProtocol: "Subdimensionado moderado",
    expectedTorqueRangeNcm: { min: 25, max: 40 },
    expectedHealingWeeks: { min: 10, typical: 12 },
  },
  D4: {
    density: "D4",
    description: "Cortical mínima, esponjosa muy fina",
    typicalLocation: "Maxilar posterior atrófico",
    drillingProtocol: "Subdimensionado agresivo",
    expectedTorqueRangeNcm: { min: 20, max: 30 },
    expectedHealingWeeks: { min: 16, typical: 20 },
  },
};

/** Devuelve el periodo de osteointegración esperado para una densidad. */
export function osseointegrationWeeksFor(density: LekholmZarbDensity): number {
  return LEKHOLM_ZARB_INFO[density].expectedHealingWeeks.typical;
}
