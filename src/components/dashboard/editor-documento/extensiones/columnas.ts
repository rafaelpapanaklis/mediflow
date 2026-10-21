// Columnas: un bloque con dos o tres columnas; cada columna lleva bloques
// normales (párrafos, listas, firmas…). Se guarda como
// `<div data-tipo="columnas" data-n="2"><div data-tipo="columna">…</div>…</div>`.

import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { COLUMNAS, type NumeroColumnas } from "../contrato";
import { dentroDe, insertarBloque } from "./insertar";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columnas: {
      /** Inserta un bloque de `n` columnas vacías y pone el cursor en la primera. */
      insertarColumnas: (n: NumeroColumnas) => ReturnType;
      /** Deshace las columnas en que está el cursor: su contenido vuelve a ser bloques normales, en orden. */
      quitarColumnas: () => ReturnType;
    };
  }
}

export const Columna = Node.create({
  name: "columna",
  content: "block+",
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-tipo="columna"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-tipo": "columna" }), 0];
  },
});

export const Columnas = Node.create({
  name: "columnas",
  group: "block",
  content: "columna{2,3}",
  isolating: true,
  defining: true,

  addAttributes() {
    return {
      n: {
        default: 2,
        parseHTML: (el) => (el.getAttribute("data-n") === "3" ? 3 : 2),
        renderHTML: (a) => ({ "data-n": String(a.n === 3 ? 3 : 2) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-tipo="columnas"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-tipo": "columnas" }), 0];
  },

  addCommands() {
    return {
      insertarColumnas:
        (n) =>
        ({ tr, state, dispatch }) => {
          if (!(COLUMNAS as readonly number[]).includes(n)) return false;
          // Columnas dentro de columnas o de una tabla no: se vuelven ilegibles en una carta.
          if (dentroDe(state, "columnas") || dentroDe(state, "table")) return false;
          if (dispatch) {
            const { schema } = state;
            const columnas = Array.from({ length: n }, () =>
              schema.nodes.columna.create(null, schema.nodes.paragraph.create()),
            );
            const nodo = schema.nodes.columnas.create({ n }, columnas);
            const pos = insertarBloque(tr, state, nodo);
            // pos = inicio de columnas; +1 entra a la primera columna; +1 al párrafo; +1 = su texto.
            tr.setSelection(TextSelection.create(tr.doc, pos + 3));
          }
          return true;
        },
      quitarColumnas:
        () =>
        ({ tr, state, dispatch }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name !== "columnas") continue;
            if (dispatch) {
              const pos = $from.before(d);
              const bloques: import("@tiptap/pm/model").Node[] = [];
              node.forEach((col) => col.forEach((b) => bloques.push(b)));
              tr.replaceWith(pos, pos + node.nodeSize, bloques);
              tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
            }
            return true;
          }
          return false;
        },
    };
  },
});
