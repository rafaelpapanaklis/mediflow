/**
 * ¿En qué pantalla CAE una consulta que se acaba de iniciar?
 *
 * Contexto — por qué hasta ahora caía en las notas SOAP:
 * "Iniciar consulta" (panel de detalle de la agenda) pone la cita en
 * IN_PROGRESS y navega a `/dashboard/patients/{id}?appointment={id}`. Ese
 * `?appointment=` NO elige pestaña: enciende la "consulta activa" de la ficha,
 * que monta la ConsultBar y el editor SOAP EN LO ALTO de la columna principal,
 * por encima de la pestaña que esté abierta (y sin `?tab=` esa pestaña es
 * Resumen). O sea que lo que llenaba la pantalla era el editor SOAP.
 *
 * No fue un descuido: SOAP (Subjetivo/Objetivo/Evaluación/Plan) es el formato
 * de nota COMÚN a todos los verticales, y la sesión de consulta cuelga de él
 * (crea el `ClinicalNote` borrador con autoguardado y "Completar" firma la
 * nota y cierra la cita). Era el único editor que servía para cualquier
 * clínica. Lo que no es, para una clínica dental, es la pantalla con la que
 * se ATIENDE: eso es "Nueva consulta" (pestaña `expediente`), el formulario
 * con odontograma, motivo/HEA, antecedentes, signos vitales y "Analizar con IA".
 *
 * Por eso la elección DEPENDE de la clínica en vez de cambiarse a lo bruto:
 * donde hay formulario clínico de consulta se cae en "Nueva consulta"; donde
 * la visita no es clínica (spa, salón, uñas, cejas, masaje, depilación láser)
 * se conserva el SOAP de siempre, que ahí funciona como nota libre de la
 * sesión. La ficha sigue montando la ConsultBar en los dos casos.
 */

/** Pestaña "Nueva consulta" de la ficha (el formulario por especialidad). */
export const CONSULT_FORM_TAB = "expediente";

/**
 * Categorías sin consulta clínica: la visita es un servicio, no una
 * exploración. Misma lista que usa la agenda para no anteponer "Dr." al
 * nombre del profesional (`src/lib/agenda/server.ts`).
 */
const NON_CLINICAL_CATEGORIES = new Set([
  "SPA",
  "MASSAGE",
  "BEAUTY_CENTER",
  "NAIL_SALON",
  "HAIR_SALON",
  "BROW_LASH",
  "LASER_HAIR_REMOVAL",
]);

/**
 * Pestaña en la que debe caer una consulta recién iniciada, o `null` para
 * dejar la ficha donde estaba (y que el editor SOAP siga siendo la superficie
 * de la sesión, como hasta ahora).
 *
 * `clinicCategory` vacío o desconocido ⇒ se asume clínica: DaleControl es
 * dental y el formulario de "Nueva consulta" existe para toda categoría.
 */
export function consultLandingTab(clinicCategory: string | null | undefined): string | null {
  if (clinicCategory && NON_CLINICAL_CATEGORIES.has(clinicCategory)) return null;
  return CONSULT_FORM_TAB;
}
