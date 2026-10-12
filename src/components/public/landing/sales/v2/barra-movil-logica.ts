/**
 * Decisiones PURAS de la barra fija de móvil (barra-movil.tsx), separadas para
 * probarlas sin navegador (11-oct-2026, ws1-t4, punto 1b del encargo de ws7).
 *
 * LIVECHAT EN MÓVIL (12-oct-2026): la barra NO toca LiveChat. Rafael ocultó el
 * lanzador en celular desde la propia configuración de LiveChat, así que no hay
 * nada que esquivar; y una llamada nuestra (`hide`/`minimize`) podría volver a
 * enseñar el lanzador que él ocultó. La versión anterior lo ocultaba mientras
 * la barra se veía y lo devolvía minimizado al subir al hero; se quitó entera
 * (la prueba whatsapp-embudo.test.ts vigila que ni barra-movil.tsx ni este
 * archivo nombren el objeto global del widget del chat ni sus métodos de
 * ocultar/minimizar). Si LiveChat volviera a verse en móvil, la decisión es de
 * Rafael: o lo oculta en su panel, o se decide aquí, nunca en los dos sitios.
 */

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
