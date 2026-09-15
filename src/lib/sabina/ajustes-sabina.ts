/**
 * Sabina — leer y guardar lo que el SUPER_ADMIN le deja hacer en nombre de cada
 * usuario (tabla `sabina_user_permissions`).
 *
 * Aquí NO se decide nada: se lee y se escribe. La decisión es
 * `permisosDeSabina` (./permisos-sabina), y la aplica `crearSabinaCtx`.
 *
 * 🔴 Cómo falla, que es lo que importa:
 *  · La tabla no existe todavía (el .sql se aplica a mano y puede ir por detrás
 *    del deploy) → `null`, que es «sin fila»: Sabina se comporta como antes de
 *    esta tabla. Es correcto y no un hueco: sin tabla no se pudo guardar ningún
 *    recorte, porque el PATCH de Equipo también la necesita.
 *  · Cualquier otro fallo (timeout, pooler saturado…) → se LANZA. Quien llama no
 *    arma el ctx y Sabina contesta «no disponible». Leer «sin recorte» ante un
 *    fallo pasajero le devolvería a Sabina lo que el SUPER_ADMIN le quitó.
 *
 * Sin `server-only`: las pruebas lo importan con un doble de base.
 */

import type { AjustesSabina } from "./permisos-sabina";

/** La rendija de base que hace falta: solo esta tabla. */
export interface DbAjustesSabina {
  sabinaUserPermission: {
    findFirst(args: any): Promise<{ enabled: boolean; permissions: string[] } | null>;
  };
}

/** ¿El error es «la tabla todavía no existe»? Solo eso abre; lo demás cierra. */
export function esTablaDeSabinaAusente(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "P2021" || code === "42P01";
}

/**
 * Lo guardado para (clínica, usuario), o `null` si no hay fila o no hay tabla.
 * Filtra SIEMPRE por las dos: los ids salen de la sesión, y si falta alguno se
 * corta antes de consultar (regla c: `clinicId: undefined` no filtra nada).
 */
export async function leerAjustesSabina(
  clinicId: string,
  userId: string,
  db?: DbAjustesSabina,
): Promise<AjustesSabina | null> {
  return (await leerAjustesSabinaConEstado(clinicId, userId, db)).ajustes;
}

/**
 * Lo mismo, diciendo además si la tabla existe. Sabina no lo necesita (sin tabla
 * y sin fila se comporta igual); la pantalla de Equipo sí, para avisar de que
 * falta aplicar el .sql en vez de dejar guardar algo que no se puede guardar.
 */
export async function leerAjustesSabinaConEstado(
  clinicId: string,
  userId: string,
  db?: DbAjustesSabina,
): Promise<{ disponible: boolean; ajustes: AjustesSabina | null }> {
  if (typeof clinicId !== "string" || !clinicId.trim() || typeof userId !== "string" || !userId.trim()) {
    throw new Error("sesion_invalida: faltan clínica o usuario para leer los permisos de Sabina");
  }
  const base = db ?? ((await import("@/lib/prisma")).prisma as unknown as DbAjustesSabina);
  try {
    const fila = await base.sabinaUserPermission.findFirst({
      where: { userId, clinicId },
      select: { enabled: true, permissions: true },
    });
    if (!fila) return { disponible: true, ajustes: null };
    return {
      disponible: true,
      ajustes: {
        activa: fila.enabled !== false,
        permisos: Array.isArray(fila.permissions) ? fila.permissions.filter((k) => typeof k === "string") : [],
      },
    };
  } catch (e) {
    if (esTablaDeSabinaAusente(e)) return { disponible: false, ajustes: null };
    throw e;
  }
}
