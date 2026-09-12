import type { SabinaTool } from "./engine-types";
import { CATALOGO_SABINA } from "./tools";

/**
 * El catálogo de herramientas que ve Sabina: las diez de `./tools`, en el orden
 * en que conviene presentárselas al modelo.
 *
 * Mientras motor y herramientas vivían en ramas separadas, esta lista estaba
 * vacía y se decía que integrar era «una línea». No lo era: además de
 * enganchar el catálogo, el motor tenía que pasarles el ctx completo
 * (`crearSabinaCtx`) y ejecutarlas por `correrHerramienta`, que es el que
 * produce `resumen` y `sin_datos`. Lo cubre `__tests__/punta-a-punta.test.ts`.
 */
export const SABINA_TOOLS: ReadonlyArray<SabinaTool<any, any>> = CATALOGO_SABINA;

/** Feature de `AiUsageEvent` (columna de texto libre, no una unión cerrada). */
export const AI_FEATURE_SABINA = "sabina";
