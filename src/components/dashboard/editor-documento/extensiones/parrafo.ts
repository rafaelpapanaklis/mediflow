// Lo que lleva un párrafo o un título además de su texto: SANGRÍA (`data-sangria`,
// 0..6, con Tab / Shift+Tab como en Word) y ALINEACIÓN (`data-alineacion`).
// Atributos enumerados, nunca `style`. Un `style="text-align:center"` pegado de
// Word se traduce al entrar y se guarda como `data-alineacion="centro"`.

import { Extension, type CommandProps } from "@tiptap/core";
import { ALINEACIONES, SANGRIA_MAX, alineacionDesdeCss, esAlineacion, sangriaValida, type Alineacion as ValorAlineacion } from "../contrato";

const TIPOS = ["paragraph", "heading"] as const;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sangria: {
      sangriaMas: () => ReturnType;
      sangriaMenos: () => ReturnType;
    };
    alineacion: {
      alinear: (alineacion: ValorAlineacion) => ReturnType;
    };
  }
}

export const Sangria = Extension.create({
  name: "sangria",

  addGlobalAttributes() {
    return [
      {
        types: [...TIPOS],
        attributes: {
          sangria: {
            default: 0,
            parseHTML: (el) => sangriaValida(el.getAttribute("data-sangria")),
            renderHTML: (a) => (a.sangria ? { "data-sangria": String(sangriaValida(a.sangria)) } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    const mover =
      (paso: number) =>
      ({ tr, state, dispatch }: CommandProps) => {
        const { from, to } = state.selection;
        let cambio = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!(TIPOS as readonly string[]).includes(node.type.name)) return;
          const actual = sangriaValida(node.attrs.sangria);
          const s = Math.max(0, Math.min(SANGRIA_MAX, actual + paso));
          if (s !== actual) {
            if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, sangria: s });
            cambio = true;
          }
        });
        return cambio;
      };
    return { sangriaMas: () => mover(1), sangriaMenos: () => mover(-1) };
  },

  // Tab: en una lista anida el ítem; en una tabla pasa de celda; en texto, sangría.
  addKeyboardShortcuts() {
    const enCelda = () => this.editor.isActive("tableCell") || this.editor.isActive("tableHeader");
    return {
      Tab: () => {
        if (this.editor.isActive("listItem")) return this.editor.commands.sinkListItem("listItem") || true;
        if (enCelda()) return this.editor.commands.goToNextCell() || true;
        return this.editor.commands.sangriaMas() || true; // true: el foco nunca sale del editor con Tab
      },
      "Shift-Tab": () => {
        if (this.editor.isActive("listItem")) return this.editor.commands.liftListItem("listItem") || true;
        if (enCelda()) return this.editor.commands.goToPreviousCell() || true;
        return this.editor.commands.sangriaMenos() || true;
      },
    };
  },
});

export const Alineacion = Extension.create({
  name: "alineacion",

  addGlobalAttributes() {
    return [
      {
        types: [...TIPOS],
        attributes: {
          alineacion: {
            default: "izquierda",
            parseHTML: (el) => {
              const propio = el.getAttribute("data-alineacion");
              if (esAlineacion(propio)) return propio;
              return alineacionDesdeCss(el.style?.textAlign || el.getAttribute("align")) ?? "izquierda";
            },
            renderHTML: (a) =>
              esAlineacion(a.alineacion) && a.alineacion !== "izquierda" ? { "data-alineacion": a.alineacion } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      alinear:
        (alineacion) =>
        ({ commands }) => {
          if (!(ALINEACIONES as readonly string[]).includes(alineacion)) return false;
          return TIPOS.map((t) => commands.updateAttributes(t, { alineacion })).some(Boolean);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-l": () => this.editor.commands.alinear("izquierda"),
      "Mod-Shift-e": () => this.editor.commands.alinear("centro"),
      "Mod-Shift-r": () => this.editor.commands.alinear("derecha"),
      "Mod-Shift-j": () => this.editor.commands.alinear("justificado"),
    };
  },
});
