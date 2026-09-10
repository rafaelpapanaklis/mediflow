/**
 * El catálogo de Sabina — la única puerta por la que el motor pide datos.
 *
 * Diez herramientas de SOLO LECTURA. El modelo no toca la base: nombra una de
 * estas y aquí se le sirve el dato ya masticado, con el `clinicId` de la sesión,
 * su permiso comprobado y un tope de 50 filas.
 *
 * ── PARA EL MOTOR (ws1-tB) ─────────────────────────────────────────────
 *
 *   import { crearSabinaCtx } from "@/lib/sabina/tipos";
 *   import { CATALOGO_SABINA, ejecutarHerramienta } from "@/lib/sabina/tools";
 *
 *   const ctx = crearSabinaCtx(await getAuthContext());
 *   if (!ctx) return 401;                       // sin clinicId no se consulta
 *   const r = await ejecutarHerramienta("citas_del_dia", ctx, { fecha: "2026-09-10" });
 *
 * `r` es SIEMPRE un `SabinaResultado`: nunca lanza, nunca devuelve `undefined` y
 * nunca contesta con una lista vacía cuando lo que falta es el permiso.
 *
 * 🔴 Y la que no se puede olvidar: cuando `r.motivo` es `"sin_permiso"`, hay que
 * DECIRLO. «No tengo datos de facturación» le hace entender al doctor que la
 * clínica no facturó nada; lo cierto es que él no tiene acceso. Lo mismo con
 * `resumen_clinica`, que trae las partes que faltan en `datos.omitidas`.
 */

import { correrHerramienta } from "./base";
import type { SabinaCtx, SabinaResultado, SabinaTool } from "../tipos";

import { citasDelDia } from "./citas-del-dia";
import { agendaOcupacion } from "./agenda-ocupacion";
import { ausencias } from "./ausencias";
import { pacientesConDeuda } from "./pacientes-con-deuda";
import { ingresosPorPeriodo } from "./ingresos-por-periodo";
import { tratamientosPorIngreso } from "./tratamientos-por-ingreso";
import { pacientesNuevos } from "./pacientes-nuevos";
import { pacientesInactivos } from "./pacientes-inactivos";
import { buscarPaciente } from "./buscar-paciente";
import { resumenClinica } from "./resumen-clinica";

/**
 * El catálogo, en el orden en que conviene presentárselo al modelo: primero la
 * foto general, después lo directo de agenda, pacientes y dinero. El orden no
 * cambia lo que hace ninguna, pero sí a cuál tiende a echar mano primero.
 */
export const CATALOGO_SABINA: SabinaTool[] = [
  resumenClinica,
  citasDelDia,
  agendaOcupacion,
  ausencias,
  buscarPaciente,
  pacientesNuevos,
  pacientesInactivos,
  ingresosPorPeriodo,
  pacientesConDeuda,
  tratamientosPorIngreso,
];

const POR_NOMBRE: Record<string, SabinaTool> = {};
for (const t of CATALOGO_SABINA) POR_NOMBRE[t.nombre] = t;

/** La herramienta con ese nombre, o `undefined` si el modelo se la inventó. */
export function herramientaPorNombre(nombre: string): SabinaTool | undefined {
  return typeof nombre === "string" ? POR_NOMBRE[nombre] : undefined;
}

/** Los nombres del catálogo. Útil para el prompt y para validar lo que pide el modelo. */
export function nombresHerramientas(): string[] {
  return CATALOGO_SABINA.map((t) => t.nombre);
}

/**
 * Corre una herramienta por nombre y devuelve la forma del contrato.
 *
 * Un nombre que no existe sale como `error` con su detalle, no como excepción:
 * el modelo a veces inventa una herramienta, y eso tiene que poder contestarse
 * («no tengo esa herramienta»), no tumbar la conversación.
 */
export async function ejecutarHerramienta(
  nombre: string,
  ctx: SabinaCtx,
  params?: unknown,
): Promise<SabinaResultado> {
  const tool = herramientaPorNombre(nombre);
  if (!tool) {
    return {
      ok: false,
      motivo: "error",
      detalle: `herramienta_desconocida: "${nombre}". Las que existen: ${nombresHerramientas().join(", ")}`,
    };
  }
  return correrHerramienta(tool, ctx, params);
}

export {
  agendaOcupacion,
  ausencias,
  buscarPaciente,
  citasDelDia,
  ingresosPorPeriodo,
  pacientesConDeuda,
  pacientesInactivos,
  pacientesNuevos,
  resumenClinica,
  tratamientosPorIngreso,
};

export { TOPE_FILAS, correrHerramienta, tienePermiso, type Lista } from "./base";
export { MAX_DIAS_RANGO } from "./fechas";
export { ESTADOS_ACTIVOS, ESTADOS_AGENDADOS, ESTADOS_CUMPLIDOS } from "./estados";

export type { DatosCitasDelDia } from "./citas-del-dia";
export type { DatosOcupacion } from "./agenda-ocupacion";
export type { DatosAusencias } from "./ausencias";
export type { DatosDeuda } from "./pacientes-con-deuda";
export type { DatosIngresos } from "./ingresos-por-periodo";
export type { DatosTratamientos } from "./tratamientos-por-ingreso";
export type { DatosNuevos } from "./pacientes-nuevos";
export type { DatosInactivos } from "./pacientes-inactivos";
export type { DatosBuscar } from "./buscar-paciente";
export type { DatosResumen, SeccionOmitida } from "./resumen-clinica";
