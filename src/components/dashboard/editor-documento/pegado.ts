// Pegar desde Word o Google Docs: se quita la basura que traen (comentarios
// condicionales, `<o:p>`, `<xml>`, estilos `mso-*`, clases `Mso*`, los `<span>`
// vacíos de Google Docs) y el resto lo filtra el propio esquema del editor: lo
// que no sea párrafo, título, lista, tabla, negrita, cursiva, subrayado, tamaño
// o alineación se pierde, y el texto se queda. Antes se perdía TODO el formato
// (el pegado entraba como texto plano).
//
// `limpiarPegado` y `textoPlanoAHtml` son PUROS (cadenas); los prueba
// `__tests__/html.test.ts`. `cerrarCorteSiBloqueVacio` trabaja sobre el corte de
// ProseMirror y lo prueba el arnés de Chromium.

import type { Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

export function limpiarPegado(html: string): string {
  return String(html ?? "")
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?o:p[^>]*>/gi, "")
    .replace(/<xml>[\s\S]*?<\/xml>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/\sclass="?Mso[^"\s>]*"?/gi, "")
    .replace(/mso-[^;"']+;?/gi, "")
    // Google Docs envuelve todo en <b style="font-weight:normal" id="docs-internal-guid-…">: no es negrita.
    .replace(/<b\s+style="font-weight:\s*normal;?"[^>]*>/gi, "<span>")
    .replace(/<span[^>]*>(\s|&nbsp;)*<\/span>/gi, " ");
}

/** Texto plano pegado (sin HTML): cada renglón es un párrafo, como lo haría Word. */
export function textoPlanoAHtml(texto: string): string {
  return String(texto ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("");
}

/**
 * ProseMirror funde el primer bloque pegado con el párrafo en que está el
 * cursor y ese párrafo se queda con SUS atributos: un título centrado de Word
 * pegado en un renglón vacío perdía el centrado. Si el párrafo está vacío, el
 * corte entra «cerrado» por delante y el bloque pegado conserva alineación y
 * sangría (comprobado en Chromium: no deja ningún párrafo vacío suelto).
 */
export function cerrarCorteSiBloqueVacio(slice: Slice, view: EditorView): Slice {
  const { $from } = view.state.selection;
  const bloque = $from.parent;
  const primero = slice.content.firstChild;
  if (slice.openStart > 0 && bloque.isTextblock && bloque.content.size === 0 && primero?.isBlock) {
    const Corte = slice.constructor as new (c: Slice["content"], a: number, b: number) => Slice;
    return new Corte(slice.content, 0, slice.openEnd);
  }
  return slice;
}
