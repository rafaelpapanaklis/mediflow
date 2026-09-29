// Ortodoncia — ws1-t4 #71 con la decisión 5 de Rafael (ws1-t10): «Pedir anticipo» se
// oculta en los controles SOLO cuando el caso cobra «a plazos» (la visita ya va en
// la mensualidad); en «pago por control» sí aparece. Puro.

export type ModoCobroDelCaso = "PRECIO_TOTAL" | "PAGO_POR_CONTROL";

/**
 * `esControl`: la cita es un control de ortodoncia. `modo`: `undefined` = la ranura aún
 * no contesta (se oculta: mejor no ofrecer un botón que va a desaparecer);
 * `null` = la cita no tiene caso (se ofrece, como cualquier cita).
 */
export function ocultarAnticipoPorMensualidad(esControl: boolean, modo: ModoCobroDelCaso | null | undefined): boolean {
  if (!esControl) return false;
  if (modo === undefined) return true;
  return modo === "PRECIO_TOTAL";
}
