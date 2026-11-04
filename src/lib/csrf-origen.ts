/**
 * Chequeo CSRF por origen para mutaciones con cookie de sesión: el host de `Origin` (o, sin él, de
 * `Referer`) tiene que ser el de `Host`. Sin ninguno de los dos, o sin `Host`, cuenta como ajeno.
 * Lo usan el middleware (mutaciones de /api/admin/*) y las server actions de admin
 * (`sesionAdminDeAccion`). Puro: corre en Edge y en Node.
 */
const METODOS_QUE_ESCRIBEN = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function origenNoCoincide(h: { get(nombre: string): string | null }, metodo: string): boolean {
  if (!METODOS_QUE_ESCRIBEN.has(metodo)) return false;
  const origin = h.get("origin");
  const referer = h.get("referer");
  const host = h.get("host");
  if (!host) return true;
  const sourceHost = (() => {
    try { return origin ? new URL(origin).host : referer ? new URL(referer).host : null; }
    catch { return null; }
  })();
  if (!sourceHost) return true;
  return sourceHost !== host;
}
