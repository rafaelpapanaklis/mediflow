// Imprimir es del navegador (`window.print()`), sin ventanas nuevas ni HTML a
// mano. Lo único que hace falta es que en el papel salga LA HOJA y nada más.
//
// Cómo: el visor pinta una copia de la hoja en un portal colgado de <body>
// (`[data-documento-impresion]`), invisible en pantalla. Al imprimir se oculta
// TODO hijo de <body> que no sea esa copia: el panel entero, el menú, los
// toasts… y con ellos la barra de acciones, que además lleva su propia regla por
// si alguien la monta algún día dentro de la copia.
//
// Por qué un portal y no `visibility: hidden` sobre el resto: la ficha del
// paciente vive dentro de contenedores con scroll (`overflow`), y un contenedor
// así RECORTA lo impreso a una sola página. Una nota larga salía cortada.
//
// Va como <style> global y no en el .module.css porque CSS Modules no deja
// escribir selectores sin una clase local (`body > *` no es «puro»).

export const ATRIBUTO_IMPRESION = "data-documento-impresion";
export const ATRIBUTO_ACCIONES = "data-documento-acciones";

export const CSS_IMPRESION = `
[${ATRIBUTO_IMPRESION}] { display: none; }
@media print {
  body > *:not([${ATRIBUTO_IMPRESION}]) { display: none !important; }
  [${ATRIBUTO_IMPRESION}] { display: block !important; }
  [${ATRIBUTO_ACCIONES}] { display: none !important; }
  html, body { background: white !important; }
  @page { margin: 18mm 20mm; }
}
`;
