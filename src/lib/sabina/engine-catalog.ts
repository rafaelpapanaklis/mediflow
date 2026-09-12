import type { SabinaTool } from "./engine-types";

/**
 * El catálogo de herramientas que ve Sabina.
 *
 * 🔴 PUNTO DE INTEGRACIÓN — esta lista está VACÍA a propósito.
 *
 * Las diez herramientas del contrato las escribe ws1-t1 en
 * `src/lib/sabina/tools/**`, que es su casilla y no la mía: el motor no las
 * escribe ni las importa mientras las dos ramas estén separadas, porque un
 * import a un archivo que todavía no existe no compila y dejaría esta rama sin
 * poder pasar `npm run typecheck`.
 *
 * Al integrar `feat/sabina-herramientas` con `feat/sabina-motor`, esto es UNA
 * línea (y está en el punto 6 del reporte):
 *
 *     export { SABINA_TOOLS } from "./tools";
 *
 * ...ajustando el nombre al que exporte ws1-t1. El motor no necesita nada más:
 * recibe las herramientas por parámetro (`ejecutarSabina({ tools })`), así que
 * no hay ningún otro sitio que tocar.
 *
 * Mientras tanto el endpoint responde con normalidad y Sabina dice que todavía
 * no puede consultar nada — que es la verdad, y es lo que manda la regla 5 del
 * contrato (no inventar) frente a la alternativa de fingir datos.
 */
export const SABINA_TOOLS: ReadonlyArray<SabinaTool<any, any>> = [];

/** Feature de `AiUsageEvent` (columna de texto libre, no una unión cerrada). */
export const AI_FEATURE_SABINA = "sabina";
