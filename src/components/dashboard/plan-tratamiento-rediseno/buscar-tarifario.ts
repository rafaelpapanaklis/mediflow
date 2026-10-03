// Buscar un procedimiento del tarifario mientras se escribe en «Nuevo plan de tratamiento»
// (ws1-t2, F15 de la auditoría BEVADENT: «escribir "Limpieza" no da sugerencias visibles y el
// precio queda en 0.00; solo "Limpieza dental", el nombre exacto, trae $700»).
//
// Antes la ventana usaba un <datalist> (que según el navegador ni se ve) y solo ponía precio con
// el nombre EXACTO. Aquí: encuentra por PARTE del nombre, sin importar mayúsculas ni acentos
// («extraccion» encuentra «Extracción dental simple»), con cada palabra escrita en cualquier
// orden, y ordena lo más parecido primero. PURO: sin React (lo prueban las pruebas).

export interface ProcedimientoDelTarifario {
  id: string;
  name: string;
  basePrice: number;
  duration: number | null;
}

/** minúsculas, sin acentos y con un solo espacio entre palabras. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** El procedimiento cuyo nombre es EXACTAMENTE lo escrito (sin contar mayúsculas, acentos ni espacios). */
export function exactoEnTarifario<T extends ProcedimientoDelTarifario>(tarifario: T[], escrito: string): T | null {
  const q = normalizar(escrito);
  if (!q) return null;
  return tarifario.find((p) => normalizar(p.name) === q) ?? null;
}

/**
 * Las sugerencias para lo escrito: todas las palabras escritas tienen que aparecer en el nombre.
 * Orden: nombre exacto → empieza igual → alguna palabra del nombre empieza igual → el resto;
 * a igualdad, el nombre más corto y luego alfabético. Sin texto, nada (no se tira la lista entera).
 */
export function buscarEnTarifario<T extends ProcedimientoDelTarifario>(tarifario: T[], escrito: string, limite = 8): T[] {
  const q = normalizar(escrito);
  if (!q) return [];
  const palabras = q.split(" ");
  const puntuados: Array<{ p: T; puntos: number; nombre: string }> = [];
  for (const p of tarifario) {
    const nombre = normalizar(p.name ?? "");
    if (!nombre || !palabras.every((w) => nombre.includes(w))) continue;
    const puntos = nombre === q ? 0
      : nombre.startsWith(q) ? 1
      : nombre.split(" ").some((w) => w.startsWith(palabras[0])) ? 2
      : 3;
    puntuados.push({ p, puntos, nombre });
  }
  puntuados.sort((a, b) => a.puntos - b.puntos || a.nombre.length - b.nombre.length || a.nombre.localeCompare(b.nombre));
  return puntuados.slice(0, Math.max(0, limite)).map((x) => x.p);
}
