import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./portales.module.css";

/**
 * La ROPA de los portales y popovers del rediseño (ws1-t4, hallazgos 13 y
 * 15): el asistente «Importar mi clínica», el menú «…» de la cabecera del
 * expediente y el popover de alertas médicas que comparten Hoy y el
 * expediente.
 *
 * Los tres se abren en un portal a <body>, fuera de la raíz de cualquier
 * pantalla, así que ninguna raíz les presta sus colores: cada caja monta
 * `CLASES_MENU` (`menu-dos-niveles/clases.ts`) ella misma —los `--m2-*` del
 * menú con su versión oscura y las dos familias tipográficas— y las clases
 * de `portales.module.css` los leen por herencia. Aquí no hay un solo color.
 *
 * ⛔ Esto no toca ni una regla: ni un paso del asistente, ni el mapeo de
 * columnas, ni la validación, ni la importación; ni una acción del menú de
 * la cabecera; ni qué alerta se enseña. Es ropa. Y solo se pone cuando el
 * componente recibe `apariencia="nueva"` (o `rediseno`), que las pantallas
 * derivan del interruptor `menu-dos-niveles`; sin eso, cada uno conserva
 * sus `style` y sus clases de siempre.
 */

/** Las clases del asistente «Importar mi clínica» (`import/import-wizard.tsx`). */
export const ROPA_IMPORTAR = {
  velo: `${CLASES_MENU} ${s.veloImportar}`,
  caja: `${CLASES_MENU} ${s.caja} ${s.importar}`,
} as const;

/** Las clases del menú «…» de la cabecera del expediente (`patient-detail/hero-card.tsx`). */
export const ROPA_MENU_FICHA = {
  caja: `${CLASES_MENU} ${s.caja} ${s.menuFicha}`,
} as const;

/** Las clases del popover de alertas médicas (`alergies-popover.tsx`). */
export const ROPA_ALERTAS = {
  caja: `${CLASES_MENU} ${s.caja} ${s.alertas}`,
  titulo: s.alertasTitulo,
  vacio: s.alertasVacio,
  seccion: s.alertasSeccion,
  seccionTitulo: s.alertasSeccionTitulo,
  peligro: s.alertasPeligro,
  aviso: s.alertasAviso,
  info: s.alertasInfo,
  lista: s.alertasLista,
  item: s.alertasItem,
  punto: s.alertasPunto,
  fuente: s.alertasFuente,
  flecha: s.alertasFlecha,
} as const;

/** «clasica» pinta exactamente lo de hoy; «nueva», la ropa del rediseño. */
export type AparienciaPortal = "clasica" | "nueva";
