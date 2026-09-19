// Clinical-shared — aplicar una plantilla a una nota a medio escribir.
//
// Archivo PURO: lo usa la ficha dental en el cliente y lo cubren las pruebas.
//
// LA REGLA: una plantilla NUNCA pisa lo que el doctor ya escribió. Campo vacío
// → entra la plantilla. Campo con texto → el texto se queda como está y la
// plantilla va DEBAJO. Y si esa misma plantilla ya está dentro del campo (el
// doctor pulsó dos veces), no se duplica.
//
// `applyTemplateToSoap` de EvolutionTemplatePicker.tsx tiene un modo «replace»
// que sí borra; aquí no existe a propósito: en la ficha dental el texto puede
// venir de un dictado o de un borrador recuperado, y perderlo no tiene vuelta.

import type { SoapTemplateBody } from "./types";

/** Los cuatro campos de texto de la nota, con los nombres de MedicalRecord. */
export interface NoteSoapFields {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

function mergeField(current: string, tpl: string): string {
  const written = current ?? "";
  const incoming = (tpl ?? "").trim();
  if (!incoming) return written;
  if (!written.trim()) return incoming;
  if (written.includes(incoming)) return written;
  return `${written.replace(/\s+$/, "")}\n\n${incoming}`;
}

/** Rellena S/O/A/P con la plantilla sin tocar lo ya escrito. */
export function applyTemplateToNote<T extends NoteSoapFields>(current: T, tpl: SoapTemplateBody): T {
  return {
    ...current,
    subjective: mergeField(current.subjective, tpl.S),
    objective: mergeField(current.objective, tpl.O),
    assessment: mergeField(current.assessment, tpl.A),
    plan: mergeField(current.plan, tpl.P),
  };
}
