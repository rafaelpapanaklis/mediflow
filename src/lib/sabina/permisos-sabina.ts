/**
 * Sabina — qué puede hacer en nombre de quien le escribe.
 *
 * 🔴 LA REGLA: Sabina NUNCA puede más que el usuario que le está escribiendo.
 *
 * El SUPER_ADMIN decide, usuario por usuario, qué le deja hacer a Sabina en su
 * nombre (Equipo → Sabina). Eso NUNCA amplía: lo que Sabina puede es la
 * INTERSECCIÓN entre lo que el usuario puede y lo que el SUPER_ADMIN le dejó. Si
 * a un usuario le quitan `billing.create`, Sabina lo pierde en ese mismo instante
 * aunque en su lista siga marcado.
 *
 * Esta función es el ÚNICO sitio donde se decide. `crearSabinaCtx` (./tipos) la
 * aplica al construir el ctx y deja el resultado en `ctx.permissionsOverride`,
 * que es lo que miran `correrHerramienta`, `confirmarPropuesta` y cualquier
 * herramienta que llame a `hasPermission` con el ctx: una herramienta nueva
 * queda gobernada sin que nadie se acuerde. Y durante la fase 2, cuando la
 * acción llama al endpoint real con la sesión del usuario, ese MISMO conjunto
 * viaja al endpoint (./recorte-en-curso): no se vuelve a calcular allí.
 *
 * Sin `server-only` y sin Prisma: la usan las pruebas y el modal de Equipo, que
 * pinta con este mismo cálculo qué casillas están apagadas y por qué.
 */

import type { Role } from "@prisma/client";
import {
  ALL_PERMISSIONS,
  getEffectivePermissions,
  type PermissionKey,
} from "@/lib/auth/permissions";

/** Lo guardado para un usuario (tabla `sabina_user_permissions`). */
export interface AjustesSabina {
  /** `false` = Sabina no hace NADA en nombre de este usuario, ni consultar. */
  activa: boolean;
  /**
   * Misma convención que `User.permissionsOverride`: vacío = todo lo que el
   * usuario puede; con keys = EXACTAMENTE esas (reemplaza, no suma).
   */
  permisos: string[];
}

/** Sin fila guardada: Sabina activa y con todo lo del usuario, que es lo de siempre. */
export const AJUSTES_SABINA_POR_DEFECTO: Readonly<AjustesSabina> = Object.freeze({ activa: true, permisos: [] });

/**
 * El override que representa «ningún permiso».
 *
 * Hace falta porque en `permissionsOverride` la lista vacía NO significa
 * «nada»: significa «los defaults del rol». Si Sabina se quedara sin permisos y
 * se escribiera `[]`, recuperaría de golpe todo lo del rol — justo el bug de
 * permisos que esto existe para no tener. Una lista con una sola key que no está
 * en el catálogo es, para `getEffectivePermissions`, un override lleno que tras
 * filtrar no concede nada.
 */
export const SABINA_SIN_PERMISOS = "sabina.sin-permisos";

/** Por qué Sabina no pudo algo. Solo cambia la FRASE; la decisión ya está tomada. */
export type CausaSinPermiso =
  /** El usuario no tiene ese permiso. */
  | "usuario"
  /** El usuario sí lo tiene, pero el SUPER_ADMIN se lo quitó a Sabina. */
  | "sabina"
  /** El SUPER_ADMIN apagó a Sabina para este usuario. */
  | "apagada";

export interface PermisosDeSabina {
  /** Lo que Sabina puede en nombre del usuario. Subconjunto de `delUsuario`, siempre. */
  permitidas: PermissionKey[];
  /** Lo que el usuario puede y Sabina no, porque el SUPER_ADMIN se lo quitó. */
  quitadas: PermissionKey[];
  /** Lo que el usuario puede (rol + override). */
  delUsuario: PermissionKey[];
  apagada: boolean;
}

/**
 * 🔴 La intersección. Recibe el usuario (rol + override, igual que
 * `hasPermission`) y lo guardado para Sabina, y devuelve lo que Sabina puede.
 *
 * `ajustes` null/undefined = sin fila = `AJUSTES_SABINA_POR_DEFECTO`.
 */
export function permisosDeSabina(
  usuario: { role: Role | string; permissionsOverride?: string[] | null },
  ajustes: AjustesSabina | null | undefined,
): PermisosDeSabina {
  const delUsuario = getEffectivePermissions({
    role: usuario.role as Role,
    permissionsOverride: usuario.permissionsOverride ?? [],
  });
  // A un SUPER_ADMIN nadie le puede editar lo de Sabina (Equipo lo rechaza, igual
  // que sus permisos). Si tenía una fila de antes de subir de rol, aplicarla lo
  // dejaría con Sabina apagada o recortada sin forma de arreglarlo desde el panel.
  const a = usuario.role === "SUPER_ADMIN" ? AJUSTES_SABINA_POR_DEFECTO : ajustes ?? AJUSTES_SABINA_POR_DEFECTO;

  // Cualquier cosa que no sea `false` explícito NO apaga: un `activa` ausente es
  // una fila vieja o un doble de prueba, no una orden del SUPER_ADMIN. Lo que
  // cierra de verdad es la intersección de abajo, que no depende de esto.
  if (a.activa === false) {
    return { permitidas: [], quitadas: [...delUsuario], delUsuario, apagada: true };
  }

  const guardadas = Array.isArray(a.permisos) ? a.permisos : [];
  // Vacía = «lo mismo que el usuario». Se mira la lista GUARDADA, antes de
  // filtrar, igual que `getEffectivePermissions`: una lista llena de keys que ya
  // no existen en el catálogo concede nada, no todo.
  if (guardadas.length === 0) {
    return { permitidas: [...delUsuario], quitadas: [], delUsuario, apagada: false };
  }

  const marcadas = new Set(
    guardadas.filter((k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(ALL_PERMISSIONS, k)),
  );
  return {
    permitidas: delUsuario.filter((k) => marcadas.has(k)),
    quitadas: delUsuario.filter((k) => !marcadas.has(k)),
    delUsuario,
    apagada: false,
  };
}

/**
 * Las `permitidas` escritas como `permissionsOverride`: SIEMPRE una lista llena,
 * para que ningún `hasPermission` caiga a los defaults del rol.
 */
export function overrideDeSabina(permitidas: readonly PermissionKey[]): string[] {
  return permitidas.length > 0 ? [...permitidas] : [SABINA_SIN_PERMISOS];
}

/**
 * Por qué no pudo: lo lee el ctx que armó `crearSabinaCtx`. Un ctx sin la marca
 * `sabina` (un doble de prueba) cuenta como «el usuario no lo tiene», que es la
 * frase de siempre.
 */
export function causaSinPermiso(
  ctx: { sabina?: { apagada: boolean; quitadas: readonly string[] } | null },
  permiso: string,
): CausaSinPermiso {
  if (ctx?.sabina?.apagada) return "apagada";
  if (ctx?.sabina?.quitadas?.includes(permiso)) return "sabina";
  return "usuario";
}

/** Lo que lee el doctor cuando el SUPER_ADMIN apagó a Sabina para su usuario. */
export const FRASE_SABINA_APAGADA =
  "El Super Admin de la clínica apagó a Sabina para tu usuario, así que no puedo consultar ni hacer nada en tu nombre. Si crees que es un error, pídele que la vuelva a activar en Equipo.";
