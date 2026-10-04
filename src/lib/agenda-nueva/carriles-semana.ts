// Qué responsables tienen carril en un día de la SEMANA (ws1-t1, tercera ronda — N-36).
//
// EL FALLO QUE CIERRA: cada día de la Semana partía su columna en un carril por responsable visible, aunque ese
// día no tuviera citas. Con los 22 profesionales de la clínica de prueba, cada día medía 22 × 76 = 1 672 px (el
// lienzo, 12 832 px) y «Semana» enseñaba un solo día por pantalla.
//
// Ahora: con pocos responsables visibles (hasta UMBRAL) cada uno conserva su carril, como hasta hoy; con más, un
// día solo abre carril a quien tiene citas ese día. Un día sin citas mide un carril. El orden y los colores son
// los de siempre.

export const UMBRAL_CARRILES_FIJOS = 3;

export function responsablesConCarril<T extends { id: string }>(
  responsables: readonly T[],
  idsConCitasEseDia: ReadonlySet<string>,
  umbral = UMBRAL_CARRILES_FIJOS,
): T[] {
  if (responsables.length <= umbral) return [...responsables];
  return responsables.filter((r) => idsConCitasEseDia.has(r.id));
}

/**
 * Las iniciales del responsable para la tarjeta de la Semana (ws1-t1, ronda final — N-B). Con varios doctores,
 * los carriles de un día van sin rótulo y solo el borde de color decía de quién era cada cita: la tarjeta lleva
 * ahora «AB · 10:00 · Limpieza». Sin títulos («Dr.», «Dra.», «Dr/a.»); una sola palabra → sus dos primeras letras.
 */
export function inicialesDelResponsable(nombre: string | null | undefined): string {
  const palabras = (nombre ?? "")
    .trim()
    .split(/\s+/)
    .filter((p) => p && !/^(dr|dra|dr\/a|lic|mtro|mtra)\.?$/i.test(p));
  if (palabras.length === 0) return "";
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0][0] + palabras[1][0]).toUpperCase();
}
