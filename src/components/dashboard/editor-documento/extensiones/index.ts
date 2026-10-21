// El esquema del editor de documentos: lo de StarterKit que está en la lista
// blanca (párrafo, títulos 1-3, negrita, cursiva, subrayado, listas, salto de
// renglón, deshacer) más lo nuestro. Lo que NO está aquí no existe para el
// editor: un enlace, un bloque de código o un color pegado de Word se cae al
// entrar y queda solo su texto. Es la primera lista blanca; la segunda, la del
// servidor (P2), vuelve a reconstruir lo que se guarda.
//
// Sin React: lo usan el editor en el navegador y las pruebas en node
// (`@tiptap/html` con este mismo esquema, para la ida y vuelta del HTML).

import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Columna, Columnas } from "./columnas";
import { Imagen } from "./imagen";
import { LineaFirma } from "./linea-firma";
import { Marcador, type EtiquetaMarcador } from "./marcador";
import { Paginacion, type PaginacionOptions } from "./paginacion";
import { Alineacion, Sangria } from "./parrafo";
import { SaltoPagina } from "./salto-pagina";
import { CeldaTabla, EncabezadoTabla, FilaTabla, Tabla } from "./tabla";
import { TamanoLetra } from "./tamano";

export interface ClasesEditor {
  marcador: string;
  imagen: string;
  saltoManual: string;
  saltoRotulo: string;
}

export interface OpcionesEsquema {
  /** Claves de marcador conocidas con su etiqueta y su ejemplo. */
  marcadores: Record<string, EtiquetaMarcador>;
  /** «Escribe aquí…» y «Nueva página». */
  textos: { placeholder: string; nuevaPagina: string };
  clases?: Partial<ClasesEditor>;
  /** Solo en el navegador: la paginación visual. */
  paginacion?: PaginacionOptions;
}

const CLASES_POR_DEFECTO: ClasesEditor = {
  marcador: "marcador",
  imagen: "imagen",
  saltoManual: "saltoManual",
  saltoRotulo: "saltoRotulo",
};

export function extensionesDocumento(o: OpcionesEsquema): Extensions {
  const clases = { ...CLASES_POR_DEFECTO, ...(o.clases ?? {}) };
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Fuera de la lista blanca: no existen para el editor.
      link: false,
      code: false,
      codeBlock: false,
      blockquote: false,
      strike: false,
      horizontalRule: false,
    }),
    Placeholder.configure({ placeholder: o.textos.placeholder }),
    Sangria,
    Alineacion,
    TamanoLetra,
    Marcador.configure({ etiquetas: o.marcadores, clase: clases.marcador }),
    Columnas,
    Columna,
    LineaFirma,
    SaltoPagina.configure({ etiqueta: o.textos.nuevaPagina, clase: clases.saltoManual, claseRotulo: clases.saltoRotulo }),
    Imagen.configure({ clase: clases.imagen }),
    Tabla,
    FilaTabla,
    CeldaTabla,
    EncabezadoTabla,
    ...(o.paginacion ? [Paginacion.configure(o.paginacion)] : []),
  ];
}

export { contarImagenes } from "./imagen";
export type { EtiquetaMarcador } from "./marcador";
export type { MedidaPaginacion, PaginacionOptions } from "./paginacion";
