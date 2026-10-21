// «Nueva página»: un salto de página manual. Lo que sigue empieza en otra hoja,
// en pantalla (paginacion.ts) y en papel (`break-after: page`). Se guarda como
// `<div data-tipo="salto-pagina"></div>`. Botón de la barra y Ctrl/Cmd + Enter.

import { Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { insertarBloque } from "./insertar";

export interface SaltoPaginaOptions {
  /** «Nueva página», el rótulo que se ve sobre la raya. */
  etiqueta: string;
  clase: string;
  claseRotulo: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    saltoPagina: {
      /** Inserta el salto y un párrafo vacío después, con el cursor en él. */
      insertarSalto: () => ReturnType;
    };
  }
}

export const SaltoPagina = Node.create<SaltoPaginaOptions>({
  name: "saltoPagina",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { etiqueta: "Nueva página", clase: "saltoManual", claseRotulo: "saltoRotulo" };
  },

  parseHTML() {
    return [{ tag: 'div[data-tipo="salto-pagina"]' }];
  },

  renderHTML() {
    return ["div", { "data-tipo": "salto-pagina" }];
  },

  addNodeView() {
    return () => {
      const dom = document.createElement("div");
      dom.className = this.options.clase;
      dom.setAttribute("data-tipo", "salto-pagina");
      dom.contentEditable = "false";
      const rotulo = document.createElement("span");
      rotulo.className = this.options.claseRotulo;
      rotulo.textContent = this.options.etiqueta;
      dom.appendChild(rotulo);
      return { dom, ignoreMutation: () => true };
    };
  },

  addCommands() {
    return {
      insertarSalto:
        () =>
        ({ tr, state, dispatch }) => {
          if (dispatch) {
            const { schema } = state;
            const pos = insertarBloque(tr, state, schema.nodes.saltoPagina.create());
            // El salto mide 1; después va un párrafo vacío para seguir escribiendo.
            tr.insert(pos + 1, schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, pos + 2));
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.insertarSalto() };
  },
});
