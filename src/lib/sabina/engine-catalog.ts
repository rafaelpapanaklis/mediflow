import type { SabinaAccion } from "./engine-acciones";
import { herramientaDeAccion } from "./engine-acciones";
import type { SabinaTool } from "./engine-types";
import { CATALOGO_SABINA } from "./tools";

/**
 * El catálogo de Sabina: lo que el modelo puede CONSULTAR y lo que puede
 * PROPONER. Es la única lista que leen el motor (`SABINA_TOOLS`) y la
 * confirmación (`ACCIONES_SABINA`).
 *
 * Mientras motor y herramientas vivían en ramas separadas, esta lista estaba
 * vacía y se decía que integrar era «una línea». No lo era: además de
 * enganchar el catálogo, el motor tenía que pasarles el ctx completo
 * (`crearSabinaCtx`) y ejecutarlas por `correrHerramienta`, que es el que
 * produce `resumen` y `sin_datos`. Lo cubre `__tests__/punta-a-punta.test.ts`.
 */

/* ── CONSULTAS ─────────────────────────────────────────────────────────────
   Las diez de `./tools`, en el orden de `CATALOGO_SABINA`. Se ejecutan dentro
   del bucle, bajo el candado de solo lectura. */
const CONSULTAS: ReadonlyArray<SabinaTool<any, any>> = CATALOGO_SABINA;

/* ── ACCIONES ──────────────────────────────────────────────────────────────
   Lo que ESCRIBE. Cada una se declara con `definirAccion` (engine-acciones.ts)
   y entra aquí con UNA línea, en el orden en que conviene presentárselas al
   modelo. El modelo solo ve su mitad `preparar` (una propuesta); la mitad
   `ejecutar` solo corre desde POST /api/sabina/propuestas/:id/confirmar.

   Al añadir una: importa la acción arriba y pon su línea en su bloque. */
export const ACCIONES_SABINA: ReadonlyArray<SabinaAccion<any, any>> = [
  // agenda (ws1-t2)
  // pacientes (ws1-t3)
];

/** Lo que ve el motor: consultas + la mitad «proponer» de cada acción. */
export const SABINA_TOOLS: ReadonlyArray<SabinaTool<any, any>> = [
  ...CONSULTAS,
  ...ACCIONES_SABINA.map((accion) => herramientaDeAccion(accion)),
];

/** Feature de `AiUsageEvent` (columna de texto libre, no una unión cerrada). */
export const AI_FEATURE_SABINA = "sabina";
