// Pediatrics — predicado canSeePediatrics (módulo + categoría + edad). Spec: §1.1, §4.A.1

import { isPediatric } from "./age";

/**
 * Key registrada en `modules.key` de marketplace para el módulo de
 * odontopediatría. Coincide con prisma/seed.ts (SEED_MODULES). Cambiar
 * AQUÍ propagaría a canAccessModule, gating de UI y server actions.
 */
export const PEDIATRICS_MODULE_KEY = "pediatric-dentistry";
export const DEFAULT_PEDIATRICS_CUTOFF_YEARS = 14;

export type PediatricsContext = {
  clinicCategory: string;
  clinicModules: string[];
  patientDob: Date | null;
  cutoffYears?: number;
};

const ELIGIBLE_CATEGORIES = new Set(["DENTAL", "MEDICINE"]);

/**
 * Predicado puro: la pestaña Pediatría se muestra cuando todos los
 * predicados son true. Si alguno falla, la pestaña se OCULTA (no se
 * deshabilita). Spec §1.1.
 */
export function canSeePediatrics(args: PediatricsContext): boolean {
  if (!ELIGIBLE_CATEGORIES.has(args.clinicCategory)) return false;
  if (!args.clinicModules.includes(PEDIATRICS_MODULE_KEY)) return false;
  if (!args.patientDob) return false;
  return isPediatric(args.patientDob, args.cutoffYears ?? DEFAULT_PEDIATRICS_CUTOFF_YEARS);
}

export function hasPediatricsModule(clinicModules: string[]): boolean {
  return clinicModules.includes(PEDIATRICS_MODULE_KEY);
}
