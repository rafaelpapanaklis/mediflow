// Ortodoncia — la fase de una hoja de control como CLAVE (ws1-t10). PURO.
// El cajón de la hoja recibía la fase unas veces como clave («ALIGNMENT») y otras ya traducida («Alineación»), y quien
// guardaba la hoja la volvía a calcular por su cuenta. Aquí se resuelve una vez: el valor que sea, a la clave.

import { PHASE_LABELS, type OrthoPhaseKey } from "@/components/specialties/orthodontics/redesign/types";

/** La clave de fase de un valor que puede ser la clave o su nombre; null si no es ninguna de las dos. */
export function claveDeFase(valor: string | null | undefined): OrthoPhaseKey | null {
  if (!valor) return null;
  const claves = Object.keys(PHASE_LABELS) as OrthoPhaseKey[];
  if (claves.includes(valor as OrthoPhaseKey)) return valor as OrthoPhaseKey;
  return claves.find((k) => PHASE_LABELS[k] === valor) ?? null;
}
