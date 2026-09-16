/**
 * Caché en memoria por instancia (mismo patrón que `getResolvedPlans` en
 * `@/lib/plans.ts`), pero con clave por-tenant en vez de un único valor
 * global: el armazón del panel (sidebar-counts, insights) pide lo mismo para
 * TODAS las pestañas y usuarios de una misma clínica cada 60 s, así que un
 * TTL corto compartido evita repetir la consulta cuando dos peticiones caen
 * en la misma instancia dentro de esa ventana.
 *
 * No cachear aquí nada cuyo resultado dependa de QUIÉN pregunta (rol,
 * visibilidad por paciente) — solo de la clínica — o dos usuarios de la
 * misma clínica con permisos distintos verían la respuesta del otro.
 */

interface Entry<T> {
  promise: Promise<T>;
  at: number;
}

const store = new Map<string, Entry<unknown>>();

export async function cachedByKey<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && now - hit.at < ttlMs) return hit.promise;

  const promise = load().catch((err) => {
    // Una consulta fallida no debe quedar "cacheada": la próxima petición
    // tiene que poder reintentar de inmediato.
    if (store.get(key)?.promise === promise) store.delete(key);
    throw err;
  });
  store.set(key, { promise, at: now });
  return promise;
}

/** Invalida una entrada tras una escritura (p. ej. marcar insights como leídos). */
export function invalidateCachedKey(key: string): void {
  store.delete(key);
}
