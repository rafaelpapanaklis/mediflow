import { instrumentSans } from "@/fonts/menu";
import s from "./menu-dos-niveles.module.css";

// La tipografía del diseño nuevo (Instrument Sans) en TODO el panel, no solo en
// el menú. El layout de /dashboard monta esto ÚNICAMENTE cuando el interruptor
// `menu-dos-niveles` está encendido para la clínica, así que va con el menú
// nuevo y se apaga con él: una clínica sin el interruptor no llega a montar
// este componente y su panel se pinta exactamente igual que hoy.
//
// Un solo sitio y no veinte: el panel entero escribe su texto con
// `var(--font-sans)` (`font-sans` de Tailwind y ~27 componentes que la nombran a
// mano), y esa variable la declara el layout raíz sobre el <body> con la clase
// de next/font. Aquí se REDECLARA sobre el mismo <body>, que es lo único que
// alcanza también a lo que el navegador saca fuera del panel: los menús de
// Radix, los tooltips y los avisos de react-hot-toast cuelgan del <body>, no de
// la caja del panel, y con la variable puesta en un <div> de dentro se habrían
// quedado con la letra vieja.
//
// `:root body` y no `body` a secas: la declaración de origen viene de una CLASE
// de next/font sobre el <body> (`.__variable_xxx`), que gana a un selector de
// elemento suelto. Con `:root` delante el selector pesa más que esa clase y no
// hace falta un `!important`.
//
// `--font-mono` NO se toca: IBM Plex Mono sigue siendo la de los importes, las
// horas y los folios, que están alineados en columna. Tampoco `--font-logo`
// (el wordmark DaleControl) ni `--font-iconos-menu`.
//
// Los NÚMEROS, y esto no es un detalle: IBM Plex Sans dibuja las diez cifras
// con el MISMO ancho (0.600 em) aunque nadie se lo pida, así que hoy cualquier
// columna de cantidades en letra normal sale cuadrada por accidente. Instrument
// Sans no: de fábrica su «1» mide 0.391 em y su «0» 0.666 em, y solo iguala los
// anchos con `tabular-nums`. Sin esta línea, los KPI, los contadores y las
// tablas que NO declaran `tabular-nums` (que son mayoría) empezarían a bailar.
// Con ella, la cifra vuelve a medir 0.600 em: exactamente lo de hoy.
//
// El menú queda fuera de esa regla (`.tokens` es su raíz, la que comparten
// menú, barra superior, desplegables y cajón): sus cifras son las que Rafael ya
// aprobó en el diseño, y no se tocan.
//
// Botones y campos: el navegador les pone `font` de fábrica, y ese atajo borra
// la herencia de los numerales (medido: un <button> dentro del panel sale con
// `font-variant-numeric: normal` aunque el <body> diga tabular). Con Plex daba
// igual —sus cifras son iguales de ancho pase lo que pase—, con Instrument no:
// los importes de un botón «Cobrar $1,250.00» y los de una columna de precios
// escritos en un campo bailarían. `inherit` les devuelve lo que toque: tabular
// en el panel, y lo del diseño dentro del menú.
//
// Esa regla va SIN `:root` delante a propósito, al contrario que la del <body>:
// solo tiene que ganarle a la hoja del navegador, y así cualquier clase que
// alguien ponga a un botón o a un campo (`tabular-nums`, y el día de mañana
// `proportional-nums` o `slashed-zero`) le sigue ganando a esto.
const CSS = [
  `:root body{--font-sans:${instrumentSans.style.fontFamily};font-variant-numeric:tabular-nums}`,
  `body button,body input,body select,body textarea{font-variant-numeric:inherit}`,
  `:root body .${s.tokens}{font-variant-numeric:normal}`,
].join("");

export function TipografiaPanel() {
  // dangerouslySetInnerHTML y no children: React escapa las comillas del nombre
  // de familia que genera next/font y el CSS saldría roto.
  return <style data-tipografia-panel dangerouslySetInnerHTML={{ __html: CSS }} />;
}
