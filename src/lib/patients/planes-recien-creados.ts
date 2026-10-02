// Planes de tratamiento recién creados en la ficha (revisión ws1-t1, fallo 4).
//
// La lista de «Plan de tratamiento» viene del servidor y solo cambiaba con
// `router.refresh()`, que re-arma la ficha entera y tarda (o no llega): tras «Crear
// plan de tratamiento» la pestaña seguía en «Sin planes de tratamiento» hasta recargar.
// El plan que devuelve el POST se pinta AL MOMENTO encima de la lista del servidor;
// cuando el servidor ya lo trae, gana la fila del servidor y la local sobra.
//
// Puro, sin React: lo usan la ficha y sus pruebas.

interface ConId { id: string }

/** La lista que se pinta: los recién creados que el servidor aún no trae, primero (más nuevos). */
export function planesConRecienCreados<T extends ConId>(delServidor: T[], recienCreados: T[]): T[] {
  if (recienCreados.length === 0) return delServidor;
  const ids = new Set(delServidor.map((p) => p.id));
  const faltan = recienCreados.filter((p) => !ids.has(p.id));
  return faltan.length ? [...faltan, ...delServidor] : delServidor;
}

/** Los recién creados que todavía hacen falta (el servidor no los trae). Misma lista si no cambia. */
export function purgarRecienCreados<T extends ConId>(delServidor: T[], recienCreados: T[]): T[] {
  if (recienCreados.length === 0) return recienCreados;
  const ids = new Set(delServidor.map((p) => p.id));
  const quedan = recienCreados.filter((p) => !ids.has(p.id));
  return quedan.length === recienCreados.length ? recienCreados : quedan;
}

/** Agrega el plan que devolvió el POST (sin duplicarlo si llega dos veces). */
export function agregarRecienCreado<T extends ConId>(recienCreados: T[], plan: T | null | undefined): T[] {
  if (!plan || typeof plan.id !== "string" || !plan.id) return recienCreados;
  return [plan, ...recienCreados.filter((p) => p.id !== plan.id)];
}

/** Quita un plan borrado (si era recién creado, ya no debe reaparecer). */
export function quitarRecienCreado<T extends ConId>(recienCreados: T[], id: string): T[] {
  return recienCreados.some((p) => p.id === id) ? recienCreados.filter((p) => p.id !== id) : recienCreados;
}
