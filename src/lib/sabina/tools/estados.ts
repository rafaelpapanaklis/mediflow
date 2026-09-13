/**
 * Los grupos de estado de cita que ya usa el panel, con el nombre de la
 * pantalla que los enseña. Están aquí, juntos y comentados, porque el repo usa
 * TRES criterios distintos y elegir el que no toca hace que Sabina diga un
 * número que ninguna pantalla enseña.
 */

/**
 * «Citas activas» — las que cuentan como cita de verdad.
 *
 * Es el criterio de los contadores del panel: el KPI "CITAS HOY" y "próximas
 * citas" de /api/patients, y la próxima cita de la ficha del paciente. Fuera las
 * canceladas (no van a pasar) y fuera las no asistidas (no pasaron).
 */
export const ESTADOS_ACTIVOS = ["CANCELLED", "NO_SHOW"] as const;

/**
 * «Citas agendadas» — todo lo que no se canceló, incluida la que no asistió.
 *
 * Es el criterio del KPI "Citas" del home del administrador
 * (`aggregateAdminPeriodKpis` en @/lib/agenda/server) y, por lo mismo, el
 * DENOMINADOR de la tasa de ausencias: una no-asistencia solo tiene sentido
 * contra las citas que sí se habían agendado.
 */
export const ESTADOS_AGENDADOS = ["CANCELLED"] as const;

/**
 * «Visitas cumplidas» — el paciente vino y se atendió.
 *
 * Es el criterio del barrido de reactivación (`src/lib/recall/sweep.ts`):
 * `status IN ('COMPLETED','CHECKED_OUT')`. CHECKED_OUT entra porque cierra el
 * ciclo de tiempos DESPUÉS de COMPLETED — dejarlo fuera volvería «inactivo» a
 * un paciente que estuvo la semana pasada.
 */
export const ESTADOS_CUMPLIDOS = ["COMPLETED", "CHECKED_OUT"] as const;

/** Etiquetas en español de los estados, para que el modelo no traduzca a ciegas. */
export const ETIQUETA_ESTADO: Record<string, string> = {
  PENDING: "pendiente",
  SCHEDULED: "agendada",
  CONFIRMED: "confirmada",
  CHECKED_IN: "llegó",
  IN_CHAIR: "en sillón",
  IN_PROGRESS: "en consulta",
  COMPLETED: "completada",
  CHECKED_OUT: "salió",
  CANCELLED: "cancelada",
  NO_SHOW: "no asistió",
};

export function etiquetaEstado(status: string): string {
  return ETIQUETA_ESTADO[status] ?? status.toLowerCase();
}
