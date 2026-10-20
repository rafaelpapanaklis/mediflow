/**
 * Qué hace el panel de solicitudes del portal (`change-requests-panel.tsx`)
 * con un 409 al aprobar o rechazar. Aparte y puro para probarlo sin pintar.
 *
 * WS1-T5 (revisión t8, A6): antes TODO 409 que no fuera `slot_taken` se leía
 * como «Esta solicitud ya fue resuelta». El 409 de la hora de comida
 * (`lunch_overlap`) deja la solicitud PENDIENTE y trae su frase: se enseña
 * esa frase y la solicitud se queda en el panel.
 */
export interface Respuesta409 {
  texto: string;
  /** Volver a pedir la lista (la solicitud cambió de estado en el servidor). */
  refrescar: boolean;
  /** Avisar a la agenda de que algo se resolvió (`onResolved`). */
  resuelta: boolean;
}

export function respuestaAl409(cuerpo: unknown): Respuesta409 {
  const b = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as { error?: unknown; reason?: unknown };
  if (b.error === "slot_taken") {
    return {
      texto: "El horario propuesto ya está ocupado; la solicitud se rechazó automáticamente",
      refrescar: true,
      resuelta: false,
    };
  }
  if (b.error !== "not_pending" && typeof b.reason === "string" && b.reason.trim()) {
    return { texto: b.reason.trim(), refrescar: false, resuelta: false };
  }
  return { texto: "Esta solicitud ya fue resuelta", refrescar: true, resuelta: true };
}
