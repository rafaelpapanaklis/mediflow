import { interpolateConsent, type ConsentTemplateVars } from "@/lib/consent/templates";
import { escapeHtml, sanitizeTemplateHtml } from "./sanitize";

export type { ConsentTemplateVars as DocumentTemplateVars };

/**
 * Rellena los marcadores de un cuerpo HTML y devuelve el HTML FINAL, el que se
 * copia a `PatientDocument.body`.
 *
 * `interpolateConsent` trabaja sobre texto plano y mete los valores tal cual.
 * Aquí el destino es HTML, así que los valores se ESCAPAN antes: un paciente
 * que se llame `<img onerror=…>` no puede convertirse en una etiqueta. Y el
 * resultado vuelve a pasar por la lista blanca, por si acaso.
 */
export function interpolateDocumentHtml(html: string, vars: ConsentTemplateVars): string {
  const seguras = { ...vars } as Record<string, unknown>;
  for (const [k, v] of Object.entries(seguras)) {
    if (typeof v === "string") seguras[k] = escapeHtml(v);
  }
  // `timezone` no se pinta: es un identificador IANA y se usa tal cual.
  seguras.timezone = vars.timezone;
  return sanitizeTemplateHtml(
    interpolateConsent(sanitizeTemplateHtml(html), seguras as unknown as ConsentTemplateVars),
  );
}
