// Leer la respuesta de una petición de Inventario desde el navegador
// (ws1-t5). Regla pura, sin red: recibe lo que devolvió `fetch`. Lo prueba
// __tests__/respuesta-cliente.test.ts.
//
// Por qué existe: la pantalla de Inventario hacía `const updated = await
// res.json()` y pintaba `updated.quantity` SIN mirar `res.ok`. Con un 403
// (sesión de solo lectura), un 404 o un 500 el cuerpo es `{ error: "…" }`:
// la existencia quedaba `undefined` en pantalla, o la fila se borraba de la
// lista aunque el servidor no hubiera borrado nada.

/**
 * Una sola forma, no una unión: el proyecto compila con `strict: false`, y
 * sin `strictNullChecks` TypeScript no estrecha una unión por `ok`.
 * Con `ok: true`, `datos` trae el cuerpo y `error` es `null`; con `ok: false`,
 * `datos` es `null` y `error` trae el mensaje del servidor (o `null`).
 */
export interface RespuestaInventario<T> {
  ok: boolean;
  datos: T | null;
  error: string | null;
}

/** Lo mínimo de `Response` que hace falta: así el test no necesita red. */
export interface RespuestaHttp {
  ok: boolean;
  json: () => Promise<unknown>;
}

/**
 * `ok: true` SOLO si el servidor respondió 2xx y el cuerpo es JSON. En
 * cualquier otro caso `ok: false`, con el mensaje del servidor si lo mandó
 * (`{ error: "…" }`) o `null` para que quien llama ponga el genérico.
 */
export async function leerRespuesta<T>(res: RespuestaHttp): Promise<RespuestaInventario<T>> {
  let cuerpo: unknown = null;
  let legible = true;
  try {
    cuerpo = await res.json();
  } catch {
    legible = false;
  }
  if (!res.ok) {
    const error =
      cuerpo && typeof cuerpo === "object" && typeof (cuerpo as { error?: unknown }).error === "string"
        ? ((cuerpo as { error: string }).error.trim() || null)
        : null;
    return { ok: false, datos: null, error };
  }
  if (!legible) return { ok: false, datos: null, error: null };
  return { ok: true, datos: cuerpo as T, error: null };
}

/**
 * La existencia que devolvió el servidor, o `null` si el cuerpo no la trae
 * como número: un 200 con un cuerpo inesperado tampoco se pinta.
 */
export function cantidadDe(datos: unknown): number | null {
  if (!datos || typeof datos !== "object") return null;
  const q = (datos as { quantity?: unknown }).quantity;
  return typeof q === "number" && Number.isFinite(q) ? q : null;
}

/** ¿Lo que devolvió el alta es un artículo (y no otra cosa con 2xx)? */
export function esArticulo(datos: unknown): datos is { id: string; name: string; quantity: number } {
  if (!datos || typeof datos !== "object") return false;
  const d = datos as { id?: unknown; name?: unknown };
  return typeof d.id === "string" && d.id !== "" && typeof d.name === "string" && cantidadDe(datos) !== null;
}
