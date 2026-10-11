/**
 * Decisiones PURAS de la barra fija de móvil (barra-movil.tsx), separadas para
 * probarlas sin navegador (11-oct-2026, ws1-t4, punto 1b del encargo de ws7).
 *
 * LA DECISIÓN DE LIVECHAT EN MÓVIL (documentada aquí y en el reporte):
 * el lanzador de LiveChat vive en la esquina inferior derecha, justo donde
 * cae el botón de WhatsApp de la barra, y su iframe va con z-index máximo, así
 * que no hay forma de ponerle la barra «encima». Se elige OCULTAR el lanzador
 * mientras la barra está a la vista, y volver a enseñarlo minimizado cuando la
 * barra se va (al subir al hero). Razones:
 *   - en un celular de 390px dos entradas al chat (burbuja + barra) son ruido
 *     y una tapa a la otra;
 *   - el tráfico frío de anuncios en móvil prefiere WhatsApp (ya tiene la app)
 *     a un chat web que pierde al cerrar la pestaña;
 *   - en escritorio no cambia NADA: la barra no existe (CSS) y LiveChat queda
 *     como estaba.
 * Si la persona YA está chateando (ventana maximizada), no se le cierra nada:
 * la barra espera. Y cuando LiveChat aún no cargó, el `call` se encola y se
 * aplica al cargar (livechat.tsx explica la cola `_q`).
 */

/** Estado de visibilidad que devuelve `LiveChatWidget.get("state").visibility`. */
export type VisibilidadLiveChat = "maximized" | "minimized" | "hidden";

export interface ContextoBarra {
  /** true bajo el ancho de móvil (`ANCHO_MOVIL_MAX`). */
  movil: boolean;
  /** true cuando la barra está a la vista (el hero ya salió de pantalla). */
  barraVisible: boolean;
  /** Estado del widget; `undefined` si aún no cargó (no se puede leer). */
  estadoChat: VisibilidadLiveChat | undefined;
  /** true si fue ESTA barra la que lo ocultó (no se restaura lo que ocultó otro). */
  ocultadoPorLaBarra: boolean;
}

/** Qué método llamar en LiveChatWidget, o null si no se toca. */
export function accionLiveChat(c: ContextoBarra): "hide" | "minimize" | null {
  if (!c.movil) return null;
  if (c.barraVisible) {
    if (c.estadoChat === "maximized") return null; // está chateando: no interrumpir
    if (c.estadoChat === "hidden") return null; // ya está oculto
    return "hide";
  }
  // la barra se fue: solo se restaura lo que ocultó la propia barra
  return c.ocultadoPorLaBarra ? "minimize" : null;
}

/** Mismo quiebre que el resto de la landing («móvil» = ≤ 760 px, landing-v2.css). */
export const ANCHO_MOVIL_MAX = 760;

/**
 * La barra se enseña cuando el hero (que ya tiene «Empieza hoy» y WhatsApp)
 * sale de pantalla, y se esconde si el hero vuelve. Se mantiene como función
 * para que la prueba fije la regla: visible ⇔ hero fuera de la vista.
 */
export function barraVisible(heroEnPantalla: boolean): boolean {
  return !heroEnPantalla;
}
