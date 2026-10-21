// Imagen del documento. En el HTML guardado NO viaja la `src`: solo la clave del
// archivo (`data-archivo="documentos/<clinicId>/<id>.webp"`), el tamaño
// (`data-ancho`) y el lado (`data-alineacion`). Para pintarla, el editor pide
// `/api/documentos/imagenes/<clave codificada>` (la ruta de P4), que firma la URL
// con el tenant comprobado. La subida la hace quien monta el editor
// (`onSubirImagen`): aquí solo se inserta la clave que devuelve.

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as NodoPM } from "@tiptap/pm/model";
import {
  ANCHOS_IMAGEN, LADOS, PATRON_ARCHIVO_IMAGEN, esAnchoImagen, esLado, rutaImagen, type AnchoImagen, type Lado,
} from "../contrato";
import { insertarBloque } from "./insertar";

export interface ImagenOptions {
  clase: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imagen: {
      /** Inserta la imagen ya subida (su clave) donde está el cursor y la deja seleccionada. */
      insertarImagen: (attrs: { archivo: string; alt?: string }) => ReturnType;
      anchoImagen: (ancho: AnchoImagen) => ReturnType;
      ladoImagen: (alineacion: Lado) => ReturnType;
    };
  }
}

/** Cuántas imágenes hay en el documento (para el tope por documento). */
export function contarImagenes(doc: NodoPM): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === "imagen") n++;
  });
  return n;
}

export const Imagen = Node.create<ImagenOptions>({
  name: "imagen",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { clase: "imagen" };
  },

  addAttributes() {
    return {
      archivo: {
        default: "",
        parseHTML: (el) => {
          const v = el.getAttribute("data-archivo") ?? "";
          return PATRON_ARCHIVO_IMAGEN.test(v) ? v : "";
        },
        renderHTML: (a) => ({ "data-archivo": a.archivo }),
      },
      ancho: {
        default: "medio",
        parseHTML: (el) => {
          const v = el.getAttribute("data-ancho");
          return esAnchoImagen(v) ? v : "medio";
        },
        renderHTML: (a) => ({ "data-ancho": esAnchoImagen(a.ancho) ? a.ancho : "medio" }),
      },
      alineacion: {
        default: "centro",
        parseHTML: (el) => {
          const v = el.getAttribute("data-alineacion");
          return esLado(v) ? v : "centro";
        },
        renderHTML: (a) => ({ "data-alineacion": esLado(a.alineacion) ? a.alineacion : "centro" }),
      },
      alt: {
        default: "",
        parseHTML: (el) => el.getAttribute("alt") ?? "",
        renderHTML: (a) => ({ alt: String(a.alt ?? "") }),
      },
    };
  },

  // Solo imágenes del almacenamiento de la clínica. Una <img src="data:…"> o
  // <img src="https://…"> pegada de Word o de una web no entra: el esquema la tira.
  parseHTML() {
    return [
      {
        tag: "img[data-archivo]",
        getAttrs: (el) => (PATRON_ARCHIVO_IMAGEN.test((el as HTMLElement).getAttribute("data-archivo") ?? "") ? {} : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  },

  // Lo que se ve: la misma <img> con la `src` que la sirve. La `src` la pone el
  // cliente al pintar y nunca llega al HTML guardado (renderHTML no la escribe).
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("img");
      dom.className = this.options.clase;
      dom.draggable = true;
      const pintar = (n: NodoPM) => {
        const archivo = String(n.attrs.archivo ?? "");
        const src = archivo ? rutaImagen(archivo) : "";
        if (dom.getAttribute("src") !== src) dom.setAttribute("src", src);
        dom.setAttribute("data-archivo", archivo);
        dom.setAttribute("data-ancho", String(n.attrs.ancho ?? "medio"));
        dom.setAttribute("data-alineacion", String(n.attrs.alineacion ?? "centro"));
        dom.setAttribute("alt", String(n.attrs.alt ?? ""));
      };
      pintar(node);
      return {
        dom,
        update: (n) => {
          if (n.type.name !== this.name) return false;
          pintar(n);
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },

  addCommands() {
    return {
      insertarImagen:
        ({ archivo, alt }) =>
        ({ tr, state, dispatch }) => {
          if (!PATRON_ARCHIVO_IMAGEN.test(archivo)) return false;
          if (dispatch) {
            const nodo = state.schema.nodes.imagen.create({ archivo, alt: alt ?? "" });
            const pos = insertarBloque(tr, state, nodo);
            tr.setSelection(NodeSelection.create(tr.doc, pos));
            tr.scrollIntoView();
          }
          return true;
        },
      anchoImagen:
        (ancho) =>
        ({ commands }) =>
          (ANCHOS_IMAGEN as readonly string[]).includes(ancho) ? commands.updateAttributes(this.name, { ancho }) : false,
      ladoImagen:
        (alineacion) =>
        ({ commands }) =>
          (LADOS as readonly string[]).includes(alineacion) ? commands.updateAttributes(this.name, { alineacion }) : false,
    };
  },
});
