// Tamaño de letra: una marca `<span data-tamano="14">`, nunca `style`. Solo los
// tamaños de la lista (contrato.ts); 12 pt es el del cuerpo y no se guarda. Un
// `font-size: 11.0pt` pegado de Word entra como «11» si está en la lista.

import { Mark, mergeAttributes } from "@tiptap/core";
import { TAMANO_BASE, esTamano, tamanoDesdeCss, type Tamano } from "../contrato";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tamano: {
      setTamano: (tamano: Tamano) => ReturnType;
      unsetTamano: () => ReturnType;
    };
  }
}

export const TamanoLetra = Mark.create({
  name: "tamano",

  addAttributes() {
    return {
      tamano: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-tamano");
          return esTamano(v) && v !== TAMANO_BASE ? v : null;
        },
        renderHTML: (a) => (esTamano(a.tamano) ? { "data-tamano": a.tamano } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-tamano]",
        // Un tamaño que no es de la lista (o el del cuerpo) no es una marca: queda el texto solo.
        getAttrs: (el) => {
          const v = (el as HTMLElement).getAttribute("data-tamano");
          return esTamano(v) && v !== TAMANO_BASE ? null : false;
        },
      },
      {
        style: "font-size",
        getAttrs: (valor) => {
          const t = tamanoDesdeCss(typeof valor === "string" ? valor : null);
          return t ? { tamano: t } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTamano:
        (tamano) =>
        ({ commands }) => {
          if (!esTamano(tamano)) return false;
          if (tamano === TAMANO_BASE) return commands.unsetMark(this.name);
          return commands.setMark(this.name, { tamano });
        },
      unsetTamano:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
