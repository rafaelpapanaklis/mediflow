import s from "./espacio-sabina.module.css";

/** Hueco al final de una lista para que el botón flotante de Sabina no tape la última fila en el teléfono. */
export function EspacioSabina() {
  return <div aria-hidden className={s.espacio} data-espacio-sabina="" />;
}
