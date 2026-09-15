/**
 * Sabina — lleva el recorte de permisos hasta el route handler de la fase 2.
 *
 * `crearSabinaCtx` ya dejó en `ctx.permissionsOverride` lo que Sabina puede en
 * nombre del usuario, y `confirmarPropuesta` comprueba con eso la key que declara
 * la acción. Pero la acción escribe llamando al endpoint REAL con la sesión del
 * usuario, y el endpoint mira los permisos del usuario, no los de Sabina. Si ese
 * endpoint exige además otra key que la acción no declaró (una factura que
 * también cobra, por ejemplo), el Super Admin se la habría quitado a Sabina en
 * vano.
 *
 * Por eso, mientras corre el handler, el conjunto que ya está en el ctx viaja
 * por `AsyncLocalStorage` y `hasPermission` (@/lib/auth/permissions) exige
 * también estar en él. No se decide nada nuevo aquí: se reusa el mismo
 * conjunto, sin volver a leer la base ni a intersecar.
 *
 * El `AsyncLocalStorage` se guarda en `globalThis` para que dos copias de este
 * módulo en el bundle (una por ruta) compartan UNA sola instancia: si cada copia
 * tuviera la suya, el lector registrado por una no vería lo que puso la otra y
 * el recorte se perdería en silencio.
 *
 * Sin `server-only`: lo importan las pruebas directamente.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Role } from "@prisma/client";
import { CLAVE_PERMISOS_SABINA_EN_CURSO, getEffectivePermissions } from "@/lib/auth/permissions";
import type { SabinaCtx } from "./tipos";

const CLAVE_ALMACEN = Symbol.for("dalecontrol.sabina.permisos-en-curso.almacen");

const global = globalThis as Record<symbol, unknown>;
const almacen: AsyncLocalStorage<ReadonlySet<string>> =
  (global[CLAVE_ALMACEN] as AsyncLocalStorage<ReadonlySet<string>> | undefined) ??
  (global[CLAVE_ALMACEN] = new AsyncLocalStorage<ReadonlySet<string>>()) as AsyncLocalStorage<ReadonlySet<string>>;

global[CLAVE_PERMISOS_SABINA_EN_CURSO] = function leerPermisosDeSabinaEnCurso() {
  return almacen.getStore() ?? null;
};

/** Corre `fn` (el route handler) con los permisos de Sabina como tope. */
export function conPermisosDeSabina<T>(ctx: Pick<SabinaCtx, "role" | "permissionsOverride">, fn: () => Promise<T>): Promise<T> {
  const permitidas = new Set<string>(
    getEffectivePermissions({ role: ctx.role as Role, permissionsOverride: ctx.permissionsOverride }),
  );
  return almacen.run(permitidas, fn);
}

/** Lo que hay en curso, o `null`. Solo para las pruebas. */
export function permisosDeSabinaEnCurso(): ReadonlySet<string> | null {
  return almacen.getStore() ?? null;
}
