// Aviso entre pestañas: «he cambiado mi menú, vuelve a pedirlo».
//
// BroadcastChannel entrega el mensaje a todos los canales del mismo nombre
// MENOS al objeto que lo envía — pero el menú y el editor son dos objetos
// distintos DENTRO de la misma pestaña, así que sin esta marca la propia
// pestaña se avisaba a sí misma y recargaba el panel dos veces por guardado.

const ESTA_PESTANA = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const CANAL = "menu-personalizado";

/** Avisa a las DEMÁS pestañas de este navegador. Nunca lanza. */
export function avisarCambioDeMenu(): void {
  try {
    const canal = new BroadcastChannel(CANAL);
    canal.postMessage({ de: ESTA_PESTANA });
    canal.close();
  } catch {
    // Navegador sin BroadcastChannel: las otras pestañas se enterarán al recargar.
  }
}

/** Escucha los avisos de OTRAS pestañas. Devuelve cómo dejar de escuchar. */
export function escucharCambioDeMenu(alCambiar: () => void): () => void {
  let canal: BroadcastChannel;
  try {
    canal = new BroadcastChannel(CANAL);
  } catch {
    return () => {};
  }
  canal.onmessage = (e: MessageEvent) => {
    if ((e.data as { de?: string } | null)?.de === ESTA_PESTANA) return;
    alCambiar();
  };
  return () => canal.close();
}
