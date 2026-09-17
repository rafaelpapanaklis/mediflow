import u from "./un-popup.module.css";

/**
 * La ropa de «una factura se cobra en UNA ventana». Va sobre el
 * `DialogContent` del detalle de la factura, AL LADO de
 * `CLASES_FACTURA_REDISENO` (que es quien monta los tokens `--m2-*`), y solo
 * cuando hay interruptor `menu-dos-niveles` y saldo que cobrar: ensancha la
 * ventana y reparte factura y cobro en dos columnas.
 */
export const CLASES_UN_POPUP = [u.unPopup, u.conCobro].join(" ");

/** El cuerpo del detalle cuando lleva la sección de cobro dentro. */
export const CLASE_CUERPO_CON_COBRO = u.cuerpoConCobro;
