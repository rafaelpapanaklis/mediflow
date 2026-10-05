// Al enfocar un campo de dinero se selecciona TODO lo que tiene (QA ws1-t3,
// 4-oct-2026): con «500.00» ya puesto, un clic y teclear 700 dejaba «500700»
// ($500,700.00). Dos detalles:
//   · el campo de «Monto a cobrar» cambia de «500.00» a «500» al enfocarse (se
//     re-pinta): la selección se hace DESPUÉS de ese re-pintado (setTimeout 0);
//   · en algunos navegadores (Safari, el celular) el mouseup/toque que sigue al
//     enfocar deshace la selección: ese primer mouseup se ignora.
import type { FocusEvent, MouseEvent } from "react";

const RECIEN = "seleccionRecien";

export function seleccionarAlEnfocar(e: FocusEvent<HTMLInputElement>): void {
  const el = e.currentTarget;
  el.dataset[RECIEN] = "1";
  setTimeout(() => {
    try { if (document.activeElement === el) el.select(); } catch { /* campo desmontado */ }
  }, 0);
}

export function conservarSeleccion(e: MouseEvent<HTMLInputElement>): void {
  const el = e.currentTarget;
  if (el.dataset[RECIEN]) {
    delete el.dataset[RECIEN];
    e.preventDefault();
    try { el.select(); } catch { /* nada */ }
  }
}
