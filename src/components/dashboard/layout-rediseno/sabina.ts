/**
 * La ROPA de Sabina fuera de su pantalla (ws1-t2, hallazgo 10): el cajón
 * lateral que sale en TODAS las pantallas del panel y las piezas del hilo
 * (contenido, rastro de herramientas, avisos) que comparten el cajón y la
 * pantalla `/dashboard/sabina`.
 *
 * Patrón «dos pieles, un esqueleto», el mismo de `sabina-client.tsx`: cada
 * componente conserva su JSX y su módulo de siempre, y elige el juego de
 * clases UNA vez (`const c = rediseno ? CLASES_X : styles`). Aquí están los
 * mapas: cada clase vieja → su pieza nueva. El test de la carpeta comprueba
 * que ninguna clase usada se queda sin traducir y que toda pieza citada
 * existe en su hoja.
 *
 * ⛔ Esto no toca ni una regla: ni el motor de Sabina, ni el texto de ningún
 * aviso, ni lo que hace un botón. Es ropa.
 */

import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import cajon from "./cajon-sabina.module.css";
import piezas from "./piezas-sabina.module.css";

/**
 * El marco del cajón (`sabina/panel.tsx` → `panel.module.css`). El botón, el
 * velo y el cajón van en `position: fixed`, fuera de la raíz de cualquier
 * pantalla: por eso los tres montan `CLASES_MENU` ellos mismos.
 */
export const CLASES_CAJON: Record<string, string> = {
  fab: `${CLASES_MENU} ${cajon.fab}`,
  fabOculto: cajon.fabOculto,
  velo: `${CLASES_MENU} ${cajon.velo}`,
  panel: `${CLASES_MENU} ${cajon.panel}`,
  panelAbierto: cajon.panelAbierto,
  cabecera: cajon.cabecera,
  marca: cajon.marca,
  titulos: cajon.titulos,
  titulo: cajon.titulo,
  subtitulo: cajon.subtitulo,
  boton: cajon.boton,
  contexto: cajon.contexto,
};

/**
 * Las piezas del hilo (`components/sabina/{message-content,tool-trace,
 * error-notice}.tsx` → `sabina-widgets.module.css`). Heredan los tokens de
 * la raíz que las contiene (la pantalla o el cajón), así que no montan nada.
 */
export const CLASES_PIEZAS_SABINA: Record<string, string> = {
  content: piezas.content,
  heading: piezas.heading,
  paragraph: piezas.paragraph,
  bullets: piezas.bullets,
  rows: piezas.rows,
  row: piezas.row,
  rowLabel: piezas.rowLabel,
  rowIndex: piezas.rowIndex,
  rowDetail: piezas.rowDetail,
  rowAmount: piezas.rowAmount,
  tableWrap: piezas.tableWrap,
  table: piezas.table,
  num: piezas.num,
  toneFact: piezas.toneFact,
  toneOpinion: piezas.toneOpinion,
  toolTrace: piezas.toolTrace,
  errorNotice: piezas.errorNotice,
  errorIcon: piezas.errorIcon,
  errorBody: piezas.errorBody,
  errorTitle: piezas.errorTitle,
  errorMessage: piezas.errorMessage,
  errorActions: piezas.errorActions,
  errorLink: piezas.errorLink,
  errorRetryBtn: piezas.errorRetryBtn,
  spin: piezas.spin,
};
