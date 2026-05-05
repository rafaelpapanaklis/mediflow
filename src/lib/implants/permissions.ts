// Implants — predicado canSeeImplants y módulo key. Spec §1.19.

/**
 * Key registrada en `modules.key` de marketplace para el módulo de
 * implantología. Cambiar AQUÍ propaga a canAccessModule, gating de UI
 * y server actions. Spec §1.19.
 */
export const IMPLANTS_MODULE_KEY = "implants";

/**
 * Categorías clínicas que pueden activar Implantología. Restringido a
 * dental (los otros sectores no aplican). Spec §1.1.
 */
const ELIGIBLE_CATEGORIES = new Set(["DENTAL"]);

export type ImplantsContext = {
  clinicCategory: string;
  clinicModules: string[];
};

/**
 * Predicado puro: la pestaña Implantología se muestra cuando todos los
 * predicados son true. Si alguno falla, la pestaña se OCULTA (no se
 * deshabilita).
 */
export function canSeeImplants(args: ImplantsContext): boolean {
  if (!ELIGIBLE_CATEGORIES.has(args.clinicCategory)) return false;
  if (!args.clinicModules.includes(IMPLANTS_MODULE_KEY)) return false;
  return true;
}

export function hasImplantsModule(clinicModules: string[]): boolean {
  return clinicModules.includes(IMPLANTS_MODULE_KEY);
}
