// GET /api/cfdi/usage una sola vez por formulario abierto (ws1-t4, auditoría de uso): lo leen
// los avisos del emisor (C-44), el aviso de retención y las opciones de envío (C-54). Se guarda
// 20 s para que tres componentes del mismo formulario no hagan tres peticiones.

let cache: { at: number; p: Promise<any | null> } | null = null;
const TTL_MS = 20_000;

export function pedirUsoCfdi(): Promise<any | null> {
  const ahora = Date.now();
  if (cache && ahora - cache.at < TTL_MS) return cache.p;
  const p = fetch("/api/cfdi/usage")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  cache = { at: ahora, p };
  return p;
}
