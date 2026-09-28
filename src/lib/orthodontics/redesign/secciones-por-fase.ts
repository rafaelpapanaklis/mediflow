// Ortodoncia — qué se enseña abierto en la pestaña del caso según la fase
// (fila 26 de la revisión de uso, ws1-t4 ronda 6).
//
// En un control de 15 minutos del mes 2 la pestaña medía 5,366 px: Retención
// y Post-tratamiento salían abiertas aunque faltaran meses para que tocaran,
// y Fotos daba por «pendiente» el juego de los 6 meses. Aquí se decide, sin
// React, qué va plegado y cuándo se pide cada juego de fotos. Nada se oculta
// del todo: lo plegado se abre con un clic y el índice sigue llevando ahí.

export type EstadoDelCasoParaSecciones =
  | "no-iniciado"
  | "en-tratamiento"
  | "retencion"
  | "completado";

export interface SeccionesPlegadas {
  retencion: boolean;
  postratamiento: boolean;
}

/**
 * Retención se abre sola al entrar en retención o al terminar, o antes si la
 * clínica ya dejó algo capturado (régimen o controles): lo que alguien
 * escribió no se esconde. Post-tratamiento, solo al terminar.
 */
export function seccionesPlegadasPorFase(entrada: {
  estado: EstadoDelCasoParaSecciones;
  hayRetencionCapturada: boolean;
}): SeccionesPlegadas {
  const yaRetiro = entrada.estado === "retencion" || entrada.estado === "completado";
  return {
    retencion: !yaRetiro && !entrada.hayRetencionCapturada,
    postratamiento: entrada.estado !== "completado",
  };
}

/** Mes del caso en que toca el juego de fotos de los 6 meses. */
export const MES_DEL_JUEGO_DE_SEIS_MESES = 6;

/**
 * El juego de los 6 meses se pide como pendiente desde el mes 6, no antes.
 * Si ya se subió, no se pide.
 */
export function juegoDeSeisMesesPendiente(entrada: {
  mesActual: number;
  yaHayJuego: boolean;
}): boolean {
  if (entrada.yaHayJuego) return false;
  return Number.isFinite(entrada.mesActual) && entrada.mesActual >= MES_DEL_JUEGO_DE_SEIS_MESES;
}
