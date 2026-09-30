// ws1-t4 (revisión final, fallo 5) — las MARCAS INTERNAS de las notas de una
// factura. PURO, client-safe.
//
// Ortodoncia reconoce sus facturas automáticas por una marca al inicio de
// `invoices.notes` (sin columna nueva): `[control-hoja:<hoja>]` para el control
// firmado sin cita (cobro/control-sin-cita.ts) y `[extra-hoja:<hoja>:<proc>]`
// para el procedimiento con costo aparte de una hoja (procedimientos-de-visita.ts).
// Esa marca es la que impide facturar dos veces la misma hoja y la que usan
// Cobranza y los extras (`notes LIKE '[control-hoja:%'`). Nadie la debe ver:
// salía en «Editar» de la factura con el UUID de la hoja.
//
//  · `notasVisibles` — lo que se enseña y se edita: las notas sin la marca.
//  · `notasParaGuardar` — al guardar lo editado, la marca que ya tenía la
//    factura se vuelve a poner delante: editar las notas nunca la borra.

const MARCA_INTERNA = /^\s*\[(?:control-hoja|extra-hoja):[^\]\n]*\]\s*/;

/** La marca interna con la que empiezan estas notas (`[control-hoja:…]`), o `null`. */
export function marcaInternaDe(notas: string | null | undefined): string | null {
  if (typeof notas !== "string") return null;
  const m = MARCA_INTERNA.exec(notas);
  return m ? m[0].trim() : null;
}

/** Las notas tal como las ve la persona: sin marcas internas al inicio. */
export function notasVisibles(notas: string | null | undefined): string {
  if (typeof notas !== "string") return "";
  let resto = notas;
  while (MARCA_INTERNA.test(resto)) resto = resto.replace(MARCA_INTERNA, "");
  return resto.trim();
}

/**
 * Las notas que se guardan al editar: las nuevas, con la marca interna que ya
 * tenía la factura delante. Si las nuevas ya traen esa marca (o no había
 * ninguna), se guardan tal cual. `null`/vacío deja solo la marca.
 */
export function notasParaGuardar(anteriores: string | null | undefined, nuevas: string | null | undefined): string | null {
  const marca = marcaInternaDe(anteriores);
  const texto = typeof nuevas === "string" ? nuevas : "";
  if (!marca) return typeof nuevas === "string" ? nuevas : null;
  if (marcaInternaDe(texto) === marca) return texto;
  const visible = notasVisibles(texto);
  return visible ? `${marca} ${visible}` : marca;
}
