import type { SabinaAccion } from "./engine-acciones";
import { herramientaDeAccion } from "./engine-acciones";
import type { SabinaTool } from "./engine-types";
import { CATALOGO_SABINA } from "./tools";
import { proponerHorarios } from "./tools/agenda-acciones";
import { accionAgendarCita, accionCancelarCita, accionReagendarCita } from "./acciones-agenda";
import { accionRegistrarPaciente } from "./acciones-pacientes";
import { accionAvisarSaldo } from "./dinero/avisar-saldo";
import { accionCobrarFactura } from "./dinero/cobrar-factura";
import { accionCrearFactura } from "./dinero/crear-factura";
import { facturasDePaciente } from "./dinero/facturas-de-paciente";
import { caja } from "./tools/caja";

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
   Las diez de `./tools`, en el orden de `CATALOGO_SABINA`, y `proponer_horarios`
   (ws1-t2), que solo lee. Se ejecutan dentro del bucle, bajo el candado de solo
   lectura. `proponer_horarios` va aquí y no en `CATALOGO_SABINA` porque las
   pruebas de contrato de ese catálogo fijan las diez de consulta; lo mismo
   `facturas_de_paciente` (dinero, ws1-t2), con sus pruebas en dinero/__tests__, y
   `caja` (ws1-t3), con sus pruebas en tools/__tests__/caja.test.ts: solo lee;
   Sabina no abre, no retira y no cierra (MAPA-caja §10). */
const CONSULTAS: ReadonlyArray<SabinaTool<any, any>> = [...CATALOGO_SABINA, proponerHorarios, facturasDePaciente, caja];

/* ── ACCIONES ──────────────────────────────────────────────────────────────
   Lo que ESCRIBE. Cada una se declara con `definirAccion` (engine-acciones.ts)
   y entra aquí con UNA línea, en el orden en que conviene presentárselas al
   modelo. El modelo solo ve su mitad `preparar` (una propuesta); la mitad
   `ejecutar` solo corre desde POST /api/sabina/propuestas/:id/confirmar.

   Al añadir una: importa la acción arriba y pon su línea en su bloque. */
export const ACCIONES_SABINA: ReadonlyArray<SabinaAccion<any, any>> = [
  // agenda (ws1-t2) — adaptadas en acciones-agenda.ts
  accionAgendarCita,
  accionReagendarCita,
  accionCancelarCita,
  // pacientes (ws1-t3) — adaptada en acciones-pacientes.ts
  accionRegistrarPaciente,
  // dinero (ws1-t2) — en dinero/. Timbrar, reembolsar, cancelar y editar precio NO
  // están, a propósito: MAPA-dinero §7.
  accionCobrarFactura,
  accionCrearFactura,
  accionAvisarSaldo,
];

/** Lo que ve el motor: consultas + la mitad «proponer» de cada acción. */
export const SABINA_TOOLS: ReadonlyArray<SabinaTool<any, any>> = [
  ...CONSULTAS,
  ...ACCIONES_SABINA.map((accion) => herramientaDeAccion(accion)),
];

/** Feature de `AiUsageEvent` (columna de texto libre, no una unión cerrada). */
export const AI_FEATURE_SABINA = "sabina";
