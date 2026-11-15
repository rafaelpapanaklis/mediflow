/**
 * Ancho de impresión del ticket y del recibo (QA B ronda 2, 15-nov: «¿si se
 * conecta una terminal de tickets para imprimir, se puede?»). Módulo PURO.
 *
 * Sin drivers ni servicios nuevos: el navegador imprime con window.print() en
 * la impresora que el sistema tenga instalada (USB o Bluetooth con su
 * controlador). Lo que cambia es la PÁGINA:
 *   · «letter» → como siempre (hoja carta, márgenes del navegador).
 *   · «80» / «58» → rollo térmico: @page con ese ancho, márgenes 0 y el LARGO
 *     exacto del ticket (medido en pantalla justo antes de imprimir), para que
 *     la impresora corte al final y no saque papel en blanco. `size: 80mm
 *     auto` no es CSS válido; por eso se mide.
 *
 * La elección se recuerda en el navegador (cada computadora o tableta tiene su
 * impresora). La llave NO empieza con «dcb:»: ese prefijo se borra al cambiar
 * de sede, y la impresora no cambia con la sede.
 */
export type PrintWidth = "letter" | "80" | "58";

export const PRINT_WIDTHS: readonly PrintWidth[] = ["letter", "80", "58"];
export const PRINT_WIDTH_KEY = "dcbprint:ancho";
export const PRINT_LOGO_KEY = "dcbprint:logo";
export const PRINT_PAGE_STYLE_ID = "dcb-print-page";

/** 1 mm en px CSS (96 px por pulgada, 25.4 mm por pulgada). */
export const PX_PER_MM = 96 / 25.4;

/** Lo que se guarda en el navegador → un ancho válido (cualquier otra cosa: carta). */
export function readPrintWidth(raw: string | null | undefined): PrintWidth {
  return raw === "80" || raw === "58" ? raw : "letter";
}

/** Clases del ticket para ese ancho (también en pantalla: lo que ves es lo que sale). */
export function printWidthClass(width: PrintWidth): string {
  return width === "letter" ? "" : `bcaja-print--thermal bcaja-print--t${width}`;
}

/**
 * Regla @page para el rollo. `heightPx` = alto del ticket ya pintado a ese
 * ancho; se le suma un margen para el corte. Para carta, cadena vacía (se
 * quita la regla y manda el navegador, como siempre).
 */
export function thermalPageCss(width: PrintWidth, heightPx: number): string {
  if (width === "letter") return "";
  const mm = Math.max(40, Math.ceil(Math.max(0, heightPx) / PX_PER_MM) + 8);
  return `@page { size: ${width}mm ${mm}mm; margin: 0; }`;
}
