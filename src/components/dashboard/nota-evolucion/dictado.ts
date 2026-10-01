/**
 * Dictado dentro del editor rico de la nota de evolución (contentEditable).
 *
 * El texto transcrito se inserta en el cursor (o al final si el cursor no está
 * en la hoja) con `insertText`, que no toca el formato de alrededor ni crea
 * etiquetas fuera de la lista blanca del saneado. Esto solo decide QUÉ texto se
 * inserta: una sola línea, y con un espacio delante si lo anterior no termina en
 * uno. Sin DOM, para poder probarlo.
 */
export function textoParaInsertar(previo: string, dictado: string): string {
  // Los saltos de línea de la transcripción se vuelven espacios: en un
  // contentEditable un «\n» crearía <div>/<br> que no son los <p> del editor.
  const limpio = String(dictado ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (!limpio) return "";
  return previo && !/\s$/.test(previo) ? ` ${limpio}` : limpio;
}
