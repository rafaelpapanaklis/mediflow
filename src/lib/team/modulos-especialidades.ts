// ═══════════════════════════════════════════════════════════════════════════
// Equipo — «Módulos de especialidades» (ws1-t2, 29-sep-2026).
//
// Sustituye a la pregunta «¿solo dental o también ortodoncista?» (ws1-t3), que
// repetía lo que ya decía «Especialidad» y además la forzaba a «Ortodoncia».
// Ahora «Especialidad» es solo la especialidad de la persona (puede ser
// Endodoncia y llevar el módulo, o ser Ortodoncia y no llevarlo) y los módulos
// van en su propia sección, con una casilla por módulo.
//
// La casilla NO guarda nada propio: leer y escribir la casilla es leer y
// escribir el permiso por persona `specialties.orthodontics` (el mismo que se
// ve en Equipo → Permisos). Por eso aquí no hay una tabla ni un campo nuevo:
// la respuesta viaja como `accesoOrtodoncia` ("ortodoncista" = marcada,
// "solo_dental" = desmarcada) y el servidor la traduce con `overrideConAcceso`.
//
// Para sumar un módulo: una fila más en MODULOS_ESPECIALIDADES con su llave.
//
// PURO: sin Prisma ni React (lo usan la pantalla y las pruebas).
// ═══════════════════════════════════════════════════════════════════════════

import type { PermissionKey } from "@/lib/auth/permissions";
import { LLAVE_MODULO_ORTODONCIA, type AccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";

export type ModuloEspecialidadId = "ortodoncia";

export interface ModuloEspecialidad {
  id: ModuloEspecialidadId;
  /** El permiso por persona que la casilla lee y escribe. */
  llave: PermissionKey;
}

/** Hoy solo Ortodoncia; la lista está lista para crecer. */
export const MODULOS_ESPECIALIDADES: readonly ModuloEspecialidad[] = [
  { id: "ortodoncia", llave: LLAVE_MODULO_ORTODONCIA },
];

/** Lo que el formulario guarda para el módulo (vacío = no aplica / sin tocar). */
export type RespuestaModulo = AccesoOrtodoncia | "";

/**
 * ¿Se pinta la sección «Módulos de especialidades»? Solo para un DOCTOR de una
 * sede dental: recepción, solo lectura y administradores no la ven (los módulos
 * por persona son de quien atiende pacientes), y las demás verticales no tienen
 * este módulo.
 */
export function seccionModulosVisible(args: { role: string; sedeDental: boolean }): boolean {
  return args.sedeDental && args.role === "DOCTOR";
}

export type MotivoCasillaDeshabilitada = "sin_modulo" | "solo_dueno";

export interface EstadoCasilla {
  marcada: boolean;
  deshabilitada: boolean;
  motivo: MotivoCasillaDeshabilitada | null;
}

/**
 * El estado de la casilla de un módulo.
 *  · Sin el módulo contratado: deshabilitada y desmarcada (no hay nada que
 *    activar), con «Contrata el módulo para activarla».
 *  · Con el módulo pero sin ser quien puede cambiar permisos (en la edición, el
 *    dueño): se ve como está, sin poder tocarla.
 */
export function estadoDeCasilla(args: {
  contratado: boolean;
  puedeCambiar: boolean;
  respuesta: RespuestaModulo;
}): EstadoCasilla {
  if (!args.contratado) return { marcada: false, deshabilitada: true, motivo: "sin_modulo" };
  return {
    marcada: args.respuesta === "ortodoncista",
    deshabilitada: !args.puedeCambiar,
    motivo: args.puedeCambiar ? null : "solo_dueno",
  };
}

/** Marcar = ortodoncista; desmarcar = solo dental. */
export function respuestaDeCasilla(marcada: boolean): AccesoOrtodoncia {
  return marcada ? "ortodoncista" : "solo_dental";
}

/**
 * Lo que viaja en el ALTA. Un doctor nuevo de una sede con el módulo arranca
 * SIN él (casilla desmarcada) hasta que se marque: no se le asignan casos por
 * omisión. Fuera de ese caso, nada viaja y el servidor ni lo mira.
 */
export function accesoParaAlta(args: { aplica: boolean; respuesta: RespuestaModulo }): RespuestaModulo {
  if (!args.aplica) return "";
  return args.respuesta || "solo_dental";
}

/**
 * Lo que viaja en la EDICIÓN: la respuesta solo si la persona la CAMBIÓ frente a
 * la que tenía al abrir el modal. Guardar el teléfono o la cédula no reescribe
 * los permisos de nadie.
 */
export function accesoQueViaja(args: { inicial: RespuestaModulo; actual: RespuestaModulo }): AccesoOrtodoncia | undefined {
  if (!args.actual || args.actual === args.inicial) return undefined;
  return args.actual;
}
