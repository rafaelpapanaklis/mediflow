// Pediatría — estado del tab del paciente. Spec §1.1 (UX clarificadora).
//
// El tab "Pediatría" tiene tres estados posibles, controlados por la
// combinación de:
//   - `moduleActive`: la clínica tiene el módulo activo en marketplace
//     (o trial vigente). Determinado por
//     `clinicModuleKeys.includes(PEDIATRICS_MODULE_KEY)`.
//   - `hasData`: el predicado `canSeePediatrics` aprobó (categoría
//     elegible + módulo activo + DOB no nulo + edad < cutoff) y
//     `loadPediatricsData` regresó datos.
//
// Estados:
//   - `enabled`  → tab visible y clickable (paciente pediátrico).
//   - `disabled` → tab visible, deshabilitado, con tooltip explicando
//     la razón. Aparece cuando el admin contrató el módulo pero el
//     paciente actual no califica clínicamente (adulto o sin DOB). Sin
//     este estado, contratar el módulo y abrir un paciente adulto
//     dejaba al usuario sin feedback.
//   - `hidden`   → tab no se renderiza. Aparece cuando la clínica no
//     tiene el módulo activo.

export type PediatricsTabState = "enabled" | "disabled" | "hidden";

export interface PediatricsTabStateInput {
  /** True si `loadPediatricsData` devolvió datos válidos. */
  hasData: boolean;
  /** True si la clínica tiene el módulo `pediatric-dentistry` activo. */
  moduleActive: boolean;
}

export const PEDIATRICS_DISABLED_REASON =
  "Disponible solo para pacientes menores de 18 años";

export function derivePediatricsTabState(
  input: PediatricsTabStateInput,
): PediatricsTabState {
  if (input.hasData) return "enabled";
  if (input.moduleActive) return "disabled";
  return "hidden";
}
