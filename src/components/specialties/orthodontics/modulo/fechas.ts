// Módulo de Ortodoncia — horas y fechas EN LA ZONA DE LA CLÍNICA (ws1-t3,
// 28-sep-2026). Puro, sin React: lo prueban los tests en node.
//
// El fallo que arregla: las vistas del módulo se pintan en el SERVIDOR, y
// `toLocaleTimeString("es-MX")` sin `timeZone` usa la zona del servidor. En
// Vercel (UTC) un control de las 09:00 de Ciudad de México salía a las 15:00,
// y una falta de las 19:30 del día 27 salía como «Faltó el 28».
//
// Dos clases de fecha, que NO se formatean igual:
//  - Un INSTANTE (`Date`: la hora de una cita) se pinta en la zona de la clínica.
//  - Una fecha de CALENDARIO ("2026-10-05": el vencimiento de una mensualidad)
//    no tiene hora ni zona: es ese día en cualquier sitio. Se pinta tal cual.

/** La misma zona por defecto que usa la Agenda (`src/lib/agenda/time-utils.ts`). */
export const ZONA_POR_DEFECTO = "America/Mexico_City";

/** La zona de la clínica si es válida; si llega vacía o mal escrita, la de por defecto. */
export function zonaValida(zona: string | null | undefined): string {
  if (!zona) return ZONA_POR_DEFECTO;
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: zona });
    return zona;
  } catch {
    return ZONA_POR_DEFECTO;
  }
}

/** «09:00 a.m.»: la hora de un instante, en la zona de la clínica. */
export function horaEnZona(instante: Date, zona: string | null | undefined): string {
  return instante.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zonaValida(zona),
  });
}

/**
 * «05 oct 2026». Un instante se pinta en la zona de la clínica; una fecha de
 * calendario ("YYYY-MM-DD"), tal cual es. `null` o algo ilegible: «—».
 */
export function fechaEnZona(fecha: Date | string | null | undefined, zona: string | null | undefined): string {
  if (!fecha) return "—";
  const formato = { day: "2-digit", month: "short", year: "numeric" } as const;
  if (typeof fecha === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
    if (!m) return "—";
    // Mediodía UTC leído en UTC: el día no se mueve, esté donde esté el servidor.
    const dia = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
    return dia.toLocaleDateString("es-MX", { ...formato, timeZone: "UTC" });
  }
  if (Number.isNaN(fecha.getTime())) return "—";
  return fecha.toLocaleDateString("es-MX", { ...formato, timeZone: zonaValida(zona) });
}
