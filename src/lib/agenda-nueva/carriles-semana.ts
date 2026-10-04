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
