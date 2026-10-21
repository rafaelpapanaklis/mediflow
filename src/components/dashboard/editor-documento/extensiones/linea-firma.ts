// Línea de firma: una raya y debajo un renglón editable («Nombre y firma del
// doctor»). A la izquierda, al centro o a la derecha. Se guarda como
// `<div data-tipo="linea-firma" data-lado="izquierda">texto</div>`.

import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { esLado, type Lado } from "../contrato";
import { insertarBloque } from "./insertar";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lineaFirma: {
      insertarLineaFirma: (texto: string) => ReturnType;
      ladoFirma: (lado: Lado) => ReturnType;
      quitarLineaFirma: () => ReturnType;
    };
  }
}

export const LineaFirma = Node.create({
  name: "lineaFirma",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    return {
      lado: {
        default: "izquierda",
        parseHTML: (el) => {
          const v = el.getAttribute("data-lado");
          return esLado(v) ? v : "izquierda";
        },
        renderHTML: (a) => ({ "data-lado": esLado(a.lado) ? a.lado : "izquierda" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-tipo="linea-firma"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-tipo": "linea-firma" }), 0];
  },

  addCommands() {
    return {
      insertarLineaFirma:
        (texto) =>
        ({ tr, state, dispatch }) => {
          if (dispatch) {
            const { schema } = state;
            const nodo = schema.nodes.lineaFirma.create(null, texto ? schema.text(texto) : null);
            const pos = insertarBloque(tr, state, nodo);
            tr.setSelection(TextSelection.create(tr.doc, pos + 1 + (texto?.length ?? 0)));
          }
          return true;
        },
      ladoFirma:
        (lado) =>
        ({ commands }) =>
          esLado(lado) ? commands.updateAttributes(this.name, { lado }) : false,
      quitarLineaFirma:
        () =>
        ({ tr, state, dispatch }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name !== this.name) continue;
            if (dispatch) {
              const pos = $from.before(d);
              tr.delete(pos, pos + $from.node(d).nodeSize);
              tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
            }
            return true;
          }
          return false;
        },
    };
  },
});
