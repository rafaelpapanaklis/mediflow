// Marcador: un dato que se rellena solo al crear el documento (`[NOMBRE_PACIENTE]`).
// En el editor es una FICHA: un nodo atómico en línea que no se puede romper
// escribiendo dentro. Se guarda como `[CLAVE]` (html.ts lo convierte), que es el
// formato que `interpolateConsent` sustituye desde siempre.

import { InputRule, Node, mergeAttributes } from "@tiptap/core";

export interface EtiquetaMarcador {
  /** «Nombre del paciente»: lo que enseña la ficha. */
  etiqueta: string;
  /** «María López»: lo que enseña con «Ver con datos de ejemplo». */
  ejemplo: string;
}

export interface MarcadorOptions {
  /** Las claves conocidas y sus textos. Una clave que no esté aquí no se convierte en ficha. */
  etiquetas: Record<string, EtiquetaMarcador>;
  /** Clase CSS de la ficha (del CSS Module del editor). */
  clase: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    marcador: {
      /** Inserta la ficha de esa clave donde está el cursor, seguida de un espacio. */
      insertarMarcador: (clave: string) => ReturnType;
    };
  }
}

export const Marcador = Node.create<MarcadorOptions>({
  name: "marcador",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { etiquetas: {}, clase: "marcador" };
  },

  addAttributes() {
    return {
      clave: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-marcador") ?? "",
        renderHTML: (a) => ({ "data-marcador": a.clave }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-marcador]" }];
  },

  // Lo que serializa getHTML(): solo la clave. html.ts lo vuelve `[CLAVE]`.
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes)];
  },

  renderText({ node }) {
    return `[${node.attrs.clave}]`;
  },

  // Lo que se VE: la etiqueta («Nombre del paciente»), o el ejemplo con «Ver con datos».
  // El texto va en atributos y lo pinta el CSS (::before), así no es editable ni se copia.
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      const clave = String(node.attrs.clave ?? "");
      const d = this.options.etiquetas[clave];
      dom.className = this.options.clase;
      dom.setAttribute("data-marcador", clave);
      dom.setAttribute("data-etiqueta", d?.etiqueta ?? clave);
      dom.setAttribute("data-ejemplo", d?.ejemplo ?? "—");
      dom.setAttribute("title", `[${clave}]`);
      dom.contentEditable = "false";
      return { dom, ignoreMutation: () => true };
    };
  },

  addCommands() {
    return {
      insertarMarcador:
        (clave) =>
        ({ commands }) => {
          if (!this.options.etiquetas[clave]) return false;
          return commands.insertContent([
            { type: this.name, attrs: { clave } },
            { type: "text", text: " " },
          ]);
        },
    };
  },

  // Escribir «[NOMBRE_PACIENTE]» a mano también lo convierte en ficha.
  addInputRules() {
    return [
      new InputRule({
        find: /\[([A-Z][A-Z0-9_]{2,})\]$/,
        handler: ({ state, range, match }) => {
          const clave = match[1];
          if (!this.options.etiquetas[clave]) return;
          state.tr.replaceWith(range.from, range.to, this.type.create({ clave }));
        },
      }),
    ];
  },
});
