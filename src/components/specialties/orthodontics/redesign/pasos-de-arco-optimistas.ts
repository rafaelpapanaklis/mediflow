// ═══════════════════════════════════════════════════════════════════════════
// «Secuencia de arcos»: filas recién creadas que la ficha todavía no re-leyó.
//
// «Agregar arco» guarda en el servidor y luego pide `router.refresh()`, que
// vuelve a armar el caso entero (segundos). Mientras tanto la tabla seguía
// diciendo «Aún no hay arcos planificados». La acción devuelve la fila que
// creó; aquí se mezcla con la secuencia del servidor para pintarla al instante.
//
// En cuanto la secuencia del servidor ya trae esa fila (mismo `id`), la
// versión local sobra y manda la del servidor. Módulo puro, sin React.
// ═══════════════════════════════════════════════════════════════════════════

import type { WireStepDTO } from "./types";

/**
 * Secuencia que se pinta: la del servidor + las filas creadas aquí que el
 * servidor aún no trae, ordenadas por `orderIndex`. Devuelve la MISMA lista
 * del servidor (misma identidad) si no hay nada que añadir.
 */
export function mezclarPasosDeArco(
  servidor: WireStepDTO[],
  locales: WireStepDTO[],
): WireStepDTO[] {
  if (locales.length === 0) return servidor;
  const ids = new Set(servidor.map((w) => w.id));
  const faltan = locales.filter((w) => !ids.has(w.id));
  if (faltan.length === 0) return servidor;
  return [...servidor, ...faltan].sort((a, b) => a.orderIndex - b.orderIndex);
}

/** Quita de las locales las que el servidor ya trae. Misma identidad si no hay que quitar. */
export function descartarPasosAlcanzados(
  servidor: WireStepDTO[],
  locales: WireStepDTO[],
): WireStepDTO[] {
  if (locales.length === 0) return locales;
  const ids = new Set(servidor.map((w) => w.id));
  const vivas = locales.filter((w) => !ids.has(w.id));
  return vivas.length === locales.length ? locales : vivas;
}

/** Añade (o reemplaza por id) una fila local. */
export function agregarPasoLocal(locales: WireStepDTO[], nuevo: WireStepDTO): WireStepDTO[] {
  return [...locales.filter((w) => w.id !== nuevo.id), nuevo];
}
