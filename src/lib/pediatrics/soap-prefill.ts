// Pediatrics — pre-fill del campo S-Subjetivo en SOAP cuando aplica. Spec: §4.B.9

import type { CambraCategory } from "./cambra";

export interface SoapPrefillInput {
  ageFormatted: string;
  latestFranklValue?: number | null;
  activeHabits: string[];
  cambraCategory: CambraCategory | null;
  cambraRecallMonths?: number | null;
}

/**
 * Genera un bloque de texto que el doctor encuentra ya en el campo
 * "S - Subjetivo" cuando empieza una consulta de un paciente pediátrico.
 * Es un assist al inicio del campo: el doctor puede borrar/editar libremente.
 *
 * Devuelve un string vacío si NO hay nada útil para mostrar (sin Frankl,
 * sin hábitos activos y sin CAMBRA), para que la consulta normal de un
 * paciente pediátrico recién dado de alta no agregue ruido al editor.
 */
export function buildPediatricSoapPrefill(input: SoapPrefillInput): string {
  const lines: string[] = [];
  if (input.latestFranklValue != null) {
    lines.push(`Frankl última visita: ${input.latestFranklValue}`);
  }
  if (input.activeHabits.length > 0) {
    lines.push(`Hábitos activos: ${input.activeHabits.join(", ")}`);
  }
  if (input.cambraCategory) {
    const recall = input.cambraRecallMonths ? ` (recall ${input.cambraRecallMonths} m)` : "";
    lines.push(`CAMBRA: ${input.cambraCategory.charAt(0).toUpperCase() + input.cambraCategory.slice(1)}${recall}`);
  }

  if (lines.length === 0) return "";
  return [`[Pediatría · ${input.ageFormatted}]`, ...lines, ""].join("\n");
}
