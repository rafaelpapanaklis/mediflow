/**
 * Guardia clínica — el ÚNICO lugar donde se decide si alguien puede ver o
 * escribir lo clínico (auditoría del 30-sep-2026, M6 y B7).
 *
 * El fallo que cierra: varias rutas y acciones del expediente comprobaban la
 * CLÍNICA (y la visibilidad del paciente) pero no el PERMISO de rol. Recepción
 * o un usuario de solo lectura exportaban el PDF de endodoncia o pediatría,
 * subían o borraban fotos clínicas, creaban un enlace público de 90 días o
 * leían y reescribían el periodontograma; y a quien el dueño le había QUITADO
 * a mano «Ver expediente clínico» se le seguía abriendo todo eso. Los módulos
 * de especialidad sí lo pedían, cada uno con su copia de la misma línea.
 *
 * Regla: lo clínico pide SIEMPRE `medicalRecord.view` para leer y
 * `medicalRecord.edit` para escribir, y además el permiso propio de la
 * pantalla cuando lo hay (`ademas`, en AND). Se resuelve con el override por
 * persona (getEffectivePermissions), así que un interruptor apagado en
 * Equipo → Permisos se respeta aquí sin más.
 *
 * `src/lib/auth/__tests__/guardia-clinica-inventario.test.ts` recorre las
 * rutas y acciones clínicas y falla si un handler no pasa por aquí.
 */

import { NextResponse } from "next/server";
import { hasPermission, mensajeSinPermiso, type PermissionKey } from "./permissions";

export type ModoClinico = "ver" | "editar";

interface UsuarioConPermisos {
  role: unknown;
  permissionsOverride?: string[] | null;
}

/** La key base de cada modo. */
export function llaveClinica(modo: ModoClinico): PermissionKey {
  return modo === "ver" ? "medicalRecord.view" : "medicalRecord.edit";
}

/**
 * Las keys que le faltan a esta persona para tocar lo clínico en `modo`.
 * Vacío = puede. Sin usuario (o rol suelto) = le falta todo: se niega, no se
 * adivina.
 */
export function permisosClinicosFaltantes(
  user: UsuarioConPermisos | null | undefined,
  modo: ModoClinico,
  ademas: readonly PermissionKey[] = [],
): PermissionKey[] {
  const pedidas = [llaveClinica(modo), ...ademas];
  if (!user || typeof user !== "object") return pedidas;
  const quien = { role: user.role as string, permissionsOverride: user.permissionsOverride ?? [] };
  return pedidas.filter((k) => !hasPermission(quien, k));
}

/** ¿Puede? Para acciones de servidor y páginas. */
export function puedeClinico(
  user: UsuarioConPermisos | null | undefined,
  modo: ModoClinico,
  ademas: readonly PermissionKey[] = [],
): boolean {
  return permisosClinicosFaltantes(user, modo, ademas).length === 0;
}

/** El texto que lee quien no tiene el permiso (mismo formato que el 403 de siempre). */
export function mensajeSinPermisoClinico(faltan: PermissionKey[]): string {
  return mensajeSinPermiso(faltan);
}

/**
 * Para route handlers: 403 con JSON (`error` legible + `permiso`) si falta
 * algo, o null si puede. Uso: `const d = denyIfNotClinical(ctx, "ver"); if (d) return d;`
 */
export function denyIfNotClinical(
  user: UsuarioConPermisos | null | undefined,
  modo: ModoClinico,
  ademas: readonly PermissionKey[] = [],
): NextResponse | null {
  const faltan = permisosClinicosFaltantes(user, modo, ademas);
  if (faltan.length === 0) return null;
  return NextResponse.json(
    { error: mensajeSinPermiso(faltan), permiso: faltan.join(" y ") },
    { status: 403 },
  );
}
