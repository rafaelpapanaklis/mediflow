// ws1-t2 (ticket BEVADENT 3, punto 12h) — ¿se capturó la salud del paciente?
//
// La cabecera de la ficha pintaba «✓ Sin alergias registradas» en VERDE con solo no tener alergias de
// riesgo: un paciente al que nunca se le llenó el cuestionario de salud salía igual de tranquilizador que
// uno al que sí. Verde solo dice la verdad cuando hay cuestionario vigente. PURO: lo usan la cabecera de la
// ficha y la de Ortodoncia, y lo prueba salud-capturada.test.ts.
//
// Criterio conservador: unas alergias escritas a mano en el alta («N/A», «Ninguna») NO bastan para el verde.
// Dicen que alguien preguntó por alergias, no que se capturó la salud (enfermedades, medicación, banderas).

export type EstadoCuestionario = "none" | "stale" | "ok";

/**
 * - `capturada`    cuestionario vigente: el verde «Sin alergias» es honesto.
 * - `vencida`      hay cuestionario pero tiene más de la ventana de `questionnaireFreshness`: ámbar.
 * - `sin_capturar` nunca se llenó: ámbar, «Salud sin capturar».
 * - `desconocida`  quien pinta no recibió el dato: no se inventa nada (se conserva el comportamiento de siempre).
 */
export type EstadoSalud = "capturada" | "vencida" | "sin_capturar" | "desconocida";

export function estadoSalud(questionnaireStatus: EstadoCuestionario | null | undefined): EstadoSalud {
  if (questionnaireStatus === "ok") return "capturada";
  if (questionnaireStatus === "stale") return "vencida";
  if (questionnaireStatus === "none") return "sin_capturar";
  return "desconocida";
}

/** ¿Hay que pintar el aviso ámbar de salud pendiente? */
export function saludPendiente(estado: EstadoSalud): boolean {
  return estado === "sin_capturar" || estado === "vencida";
}

/** ¿Se puede pintar el chip verde «Sin alergias registradas»? Solo con salud capturada (o sin dato, como siempre). */
export function puedePintarSinAlergias(estado: EstadoSalud): boolean {
  return estado === "capturada" || estado === "desconocida";
}
