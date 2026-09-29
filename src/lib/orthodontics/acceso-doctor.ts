// ═══════════════════════════════════════════════════════════════════════════
// Ortodoncia — acceso al módulo POR PERSONA (ws1-t3, 28-sep-2026).
//
// Decisión de Rafael: «un doctor es un doctor»; lo que cambia es si tiene o no
// acceso al módulo de Ortodoncia. Ese acceso es UNA sola llave,
// `specialties.orthodontics` («Acceso al módulo de Ortodoncia» en Equipo →
// Permisos). Esta llave se SUMA a que la sede tenga el módulo contratado:
// ninguna de las dos basta sola. Lo que cada quien hace DENTRO del módulo lo
// siguen decidiendo las llaves de siempre (medicalRecord.* para el expediente
// clínico y billing.charge para cobrar mensualidades): recepción cobra sin
// ver el diagnóstico y el doctor registra sin cobrar.
//
// PURO: sin Prisma ni React. Lo usan el alta y la edición de Equipo, las
// server actions del módulo y sus pruebas.
// ═══════════════════════════════════════════════════════════════════════════

import type { Role } from "@prisma/client";
import {
  getEffectivePermissions,
  hasPermission,
  type PermissionKey,
} from "@/lib/auth/permissions";

/** La única llave del módulo. */
export const LLAVE_MODULO_ORTODONCIA: PermissionKey = "specialties.orthodontics";

/**
 * Lo que dice la casilla «Ortodoncia» de «Módulos de especialidades» al crear o
 * editar un doctor: marcada = "ortodoncista", desmarcada = "solo_dental". Solo
 * decide el permiso; la especialidad de la persona es aparte (ws1-t2).
 */
export type AccesoOrtodoncia = "ortodoncista" | "solo_dental";

/** La especialidad «Ortodoncia» de Equipo: la lista de doctores tratantes la usa para poner primero a quien la tiene. */
export const ESPECIALIDAD_ORTODONCIA = "Ortodoncia";

export function esAccesoOrtodoncia(valor: unknown): valor is AccesoOrtodoncia {
  return valor === "ortodoncista" || valor === "solo_dental";
}

interface UsuarioConPermisos {
  role: Role | string;
  permissionsOverride?: string[] | null;
}

/** ¿Esta persona puede entrar al módulo (la mitad «persona» del guardia)? */
export function tieneAccesoOrtodoncia(user: UsuarioConPermisos): boolean {
  return hasPermission(user, LLAVE_MODULO_ORTODONCIA);
}

/** El mensaje que ve quien llega a una acción del módulo sin la llave. */
export const MENSAJE_SIN_ACCESO_ORTODONCIA =
  "No tienes acceso al módulo de Ortodoncia. Pídele a quien administra la clínica que lo active en Equipo → Permisos.";

/**
 * El `permissionsOverride` que deja a la persona con o sin el módulo SIN tocar
 * nada más de lo que ya puede hacer.
 *
 * El override REEMPLAZA al default del rol (no se mezcla), así que:
 *  · «ortodoncista» sobre alguien que ya lo tiene → no cambia nada (devuelve el
 *    override actual, vacío si sigue el default del rol). Sobre alguien a quien
 *    se lo quitaron → su conjunto efectivo + la llave.
 *  · «solo_dental» sobre alguien que lo tiene → su conjunto efectivo SIN la
 *    llave (ya explícito, porque un override vacío volvería al default del rol,
 *    que la trae). Sobre alguien que ya no lo tiene → no cambia nada.
 *
 * Devuelve `null` cuando quitarle la llave lo dejaría sin NINGÚN permiso: un
 * override vacío significa «default del rol», o sea que la llave volvería sola.
 * Ese caso raro se resuelve a mano en Equipo → Permisos.
 */
export function overrideConAcceso(user: UsuarioConPermisos, acceso: AccesoOrtodoncia): string[] | null {
  const actual = user.permissionsOverride ?? [];
  const efectivos = getEffectivePermissions({ role: user.role as Role, permissionsOverride: actual });
  const loTiene = efectivos.includes(LLAVE_MODULO_ORTODONCIA);

  if (acceso === "ortodoncista") {
    return loTiene ? [...actual] : [...efectivos, LLAVE_MODULO_ORTODONCIA];
  }
  if (!loTiene) return [...actual];
  const sinLlave = efectivos.filter((k) => k !== LLAVE_MODULO_ORTODONCIA);
  return sinLlave.length > 0 ? sinLlave : null;
}
