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
 * misma clínica con permisos distintos verían la respuesta del otro. Si
 * depende, el userId y el rol van en la clave (ver `claveDeClinica`).
 *
 * ── POR QUÉ EN MEMORIA Y NO `unstable_cache` NI REDIS (ws1-t1, 23-sep-2026) ──
 * · `unstable_cache` sirve la entrada CADUCADA y la refresca por detrás
 *   (`cacheEntry.isStale` en next/dist/server/web/spec-extension/
 *   unstable-cache.js): tras una noche sin uso, el primer vistazo enseñaría el
 *   contador de ayer. Aquí una entrada vencida NO se sirve nunca: el TTL es
 *   la edad máxima, no una sugerencia.
 * · Upstash cobra por comando y cada sondeo serían varios: eso lo decide Rafael.
 * El precio de ir en memoria: en Vercel cada instancia tiene la suya, así que
 * invalidar solo limpia la instancia que atendió la escritura. Por eso quien
 * ESCRIBE pide su siguiente lectura con `fresco` (salta la caché), y los
 * demás ven el cambio como mucho un TTL después.
 */

interface Entry<T> {
  promise: Promise<T>;
  vence: number;
}

const store = new Map<string, Entry<unknown>>();

// Las claves por usuario (activity, sala de espera) se acumulan: una limpieza
// barata de vez en cuando, como la de `@/lib/rate-limit`.
let ultimaLimpieza = Date.now();
function limpiar(ahora: number) {
  if (ahora - ultimaLimpieza < 5 * 60_000) return;
  ultimaLimpieza = ahora;
  store.forEach((e, k) => { if (e.vence <= ahora) store.delete(k); });
}

/**
 * La clave de una entrada del armazón. La clínica va SIEMPRE, y va segunda,
 * detrás del nombre de la pieza: una clave sin clínica serviría el contador
 * de una clínica a otra, que es el fallo más grave posible aquí. Por eso un
 * clinicId vacío o que no sea texto no produce clave: lanza.
 *
 * `resto` es todo lo demás de lo que depende el resultado (userId y rol
 * cuando hay visibilidad por paciente, parámetros de la consulta).
 */
export function claveDeClinica(pieza: string, clinicId: string, ...resto: Array<string | number>): string {
  if (typeof clinicId !== "string" || clinicId.trim() === "") {
    throw new Error(`[route-cache] ${pieza}: clave sin clínica`);
  }
  return [pieza, clinicId, ...resto].join(":");
}

export async function cachedByKey<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  opciones: { fresco?: boolean } = {},
): Promise<T> {
  const now = Date.now();
  limpiar(now);
  const hit = store.get(key) as Entry<T> | undefined;
  // `fresco`: quien acaba de cambiar el dato no puede leer lo de antes. Se
  // salta la lectura, pero el resultado nuevo SÍ se guarda para los demás.
  if (!opciones.fresco && hit && now < hit.vence) return hit.promise;

  const promise = load().catch((err) => {
    // Una consulta fallida no debe quedar "cacheada": la próxima petición
    // tiene que poder reintentar de inmediato.
    if (store.get(key)?.promise === promise) store.delete(key);
    throw err;
  });
  store.set(key, { promise, vence: now + ttlMs });
  return promise;
}

/** Invalida una entrada tras una escritura (p. ej. marcar insights como leídos). */
export function invalidateCachedKey(key: string): void {
  store.delete(key);
}
