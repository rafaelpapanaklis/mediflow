/**
 * WS1-T4 ronda 6 · G6 — a qué agenda llevan los enlaces sueltos del panel.
 *
 * Con el menú nuevo (interruptor `menu-dos-niveles`, el mismo que elige la
 * ropa de «Nueva cita») los enlaces van a la agenda nueva, /dashboard/agenda.
 * Con el menú de siempre se quedan en la clásica, /dashboard/appointments,
 * que es la que sabe abrir su formulario con `?new=1`.
 *
 * Archivo puro: quien lo llama ya sabe si el menú nuevo está encendido (en
 * cliente, `useNewAppointmentDialog().apariencia === "nueva"`; en servidor,
 * `menuDosNivelesEncendido(clinicId)`).
 */

export const RUTA_AGENDA_NUEVA = "/dashboard/agenda";
export const RUTA_AGENDA_CLASICA = "/dashboard/appointments";

/** La agenda a la que se enlaza. */
export function rutaAgenda(menuNuevo: boolean): string {
  return menuNuevo ? RUTA_AGENDA_NUEVA : RUTA_AGENDA_CLASICA;
}

/** La agenda abierta en la vista de semana. */
export function rutaAgendaSemana(menuNuevo: boolean): string {
  return `${rutaAgenda(menuNuevo)}?view=week`;
}

/**
 * El enlace de «Nueva cita» cuando NO hay un manejador propio.
 * Con el menú nuevo devuelve `null`: ahí no se navega, se abre la ventana
 * «Nueva cita» (la agenda nueva no tiene `?new=1`).
 */
export function enlaceNuevaCita(menuNuevo: boolean): string | null {
  return menuNuevo ? null : `${RUTA_AGENDA_CLASICA}?new=1`;
}
