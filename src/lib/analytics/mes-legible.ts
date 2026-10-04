// Formatos legibles de la Analítica (ws1-t2, auditoría de uso C-25 y C-37).
// Puro y sin imports de servidor: lo usan las pantallas de cliente.
//
// La retención por cohorte enseñaba «2026-09» y Reportes «may 26»: claves y
// abreviaturas, no fechas para una persona. Aquí se dicen como «sep 2026».

/** «2026-09» → «sep 2026» (en inglés, «Sep 2026»). Una clave que no sea AAAA-MM se devuelve tal cual. */
export function mesLegible(clave: string, idioma: "es" | "en" = "es"): string {
  const m = /^(\d{4})-(\d{2})$/.exec(clave);
  if (!m) return clave;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15, 12));
  return d
    .toLocaleDateString(idioma === "en" ? "en-US" : "es-MX", { month: "short", year: "numeric", timeZone: "UTC" })
    .replace(".", "");
}

/** Minutos enteros entre `iso` y `ahora` (0 si `iso` falta o es del futuro). */
export function minutosDesde(iso: string | null | undefined, ahora: Date = new Date()): number {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - t) / 60_000));
}
