// La tabla de Tiptap, pero serializada como manda el contrato: `<table><tbody>…`
// sin `style`, sin `<colgroup>`, sin anchos de columna; en las celdas solo
// `colspan`/`rowspan` cuando valen más de 1. Sin redimensionar columnas (eso
// guardaría anchos, y en papel el ancho lo decide la hoja).

import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { mergeAttributes } from "@tiptap/core";

/** `colspan="1"` / `rowspan="1"` es «sin unir»: no se escribe. */
function sinUnos(attrs: Record<string, unknown>): Record<string, unknown> {
  const a = { ...attrs };
  if (String(a.colspan ?? "1") === "1") delete a.colspan;
  if (String(a.rowspan ?? "1") === "1") delete a.rowspan;
  return a;
}

const sinAnchoNiAlineacion = {
  colwidth: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
  align: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
};

export const Tabla = Table.extend({
  renderHTML() {
    return ["table", {}, ["tbody", 0]];
  },
}).configure({ resizable: false, cellMinWidth: 40 });

export const FilaTabla = TableRow;

export const CeldaTabla = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...sinAnchoNiAlineacion };
  },
  renderHTML({ HTMLAttributes }) {
    return ["td", mergeAttributes(sinUnos(HTMLAttributes)), 0];
  },
});

export const EncabezadoTabla = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...sinAnchoNiAlineacion };
  },
  renderHTML({ HTMLAttributes }) {
    return ["th", mergeAttributes(sinUnos(HTMLAttributes)), 0];
  },
});
