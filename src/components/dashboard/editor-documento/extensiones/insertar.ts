// Cómo se mete un bloque nuevo (tabla, columnas, imagen, firma, salto) donde
// está el cursor: después del bloque de primer nivel en el que se escribe, o en
// lugar de él si es un párrafo vacío (así no queda un renglón en blanco). Lo
// comparten todas las extensiones propias para que se comporten igual.

import type { Node as NodoPM } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

/** Inserta `nodo` y devuelve la posición donde quedó (su inicio). */
export function insertarBloque(tr: Transaction, state: EditorState, nodo: NodoPM): number {
  const { $from, to } = state.selection;
  if ($from.depth === 0) {
    // Selección de un nodo de primer nivel (imagen, salto): va después de él.
    tr.insert(to, nodo);
    return to;
  }
  const bloque = $from.node(1);
  const inicio = $from.before(1);
  const fin = $from.after(1);
  if (bloque.type.name === "paragraph" && bloque.content.size === 0) {
    tr.replaceWith(inicio, fin, nodo);
    return inicio;
  }
  tr.insert(fin, nodo);
  return fin;
}

/** El nombre del bloque de primer nivel en que está el cursor (o `null` si la selección es del documento). */
export function bloqueActual(state: EditorState): NodoPM | null {
  const { $from } = state.selection;
  return $from.depth >= 1 ? $from.node(1) : null;
}

/** ¿Hay un antecesor con ese nombre? */
export function dentroDe(state: EditorState, nombre: string): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === nombre) return true;
  return false;
}
