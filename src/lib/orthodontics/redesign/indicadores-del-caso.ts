// Ortodoncia — los indicadores de la cabecera del caso (ws1-t4 ronda 6, filas
// 8 y 9 de la revisión de lógica de uso). Puro: sin Prisma, sin React y sin
// `Date.now()` implícito.
//
// EL FALLO QUE ARREGLA. La cabecera enseñaba datos que no eran reales:
//  - «Asistencia 100 %» salía de `OrthodonticControlAppointment`, una tabla
//    que hoy nadie llena: sin filas, el cálculo devolvía 100. Un paciente con
//    tres faltas en la Agenda salía con asistencia perfecta.
//  - «Uso de elásticos 0 %» salía de una entrada de bitácora que escribía una
//    pantalla ya retirada. El paciente que marca sus elásticos todos los días
//    en el portal salía en 0 %.
//  - «Visitas 0» y «Última visita —» con un control registrado hoy.
//  - «Próxima cita: Sin programar» a mediodía, con el control de las 10:00 de
//    hoy todavía por atender.
//
// DE DÓNDE SALE AHORA CADA DATO
//  - Los controles son citas de la Agenda del tipo «Control de ortodoncia»
//    (decisión 2 de la arquitectura) y hojas de control registradas.
//  - Los elásticos, lo que marca el paciente en el portal o recepción a mano
//    (`OrthodonticElasticsLog`), con la misma ventana y la misma meta que el
//    panel «Alineadores y cumplimiento» de la ficha.
//  - Sin datos no se inventa un número: se devuelve `null` y la pantalla
//    pinta «—».

import { summarizeElasticsCompliance, type ElasticsLogEntry } from "../elastics/compliance";

/** Los mismos valores que usa el panel «Alineadores y cumplimiento». */
export const VENTANA_ELASTICOS_DIAS = 14;
export const META_ELASTICOS_HORAS = 20;

/** Cuántos meses hacia atrás cuenta la asistencia. La cabecera dice «últimos 6 meses». */
export const MESES_DE_ASISTENCIA = 6;

export interface CitaDeControlDelCaso {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

export interface HojaDeControlDelCaso {
  appointmentId: string | null;
  visitDate: Date;
}

/**
 * ws1-t8 (revisión final de ortodoncia, fallo 2): las hojas que cuentan para «Asistencia» y «Visitas» son las
 * FIRMADAS. Un borrador (p. ej. el que queda al elegir «Registrar la colocación primero») todavía no es un control
 * hecho: antes contaba, y la cabecera decía «Asistencia 100 % · 1 de 1 controles» y «Visitas 1» sin ningún control
 * firmado. Una cita a la que el paciente SÍ llegó sigue contando por sí misma, tenga hoja o no.
 */
export function hojasFirmadas(
  hojas: ReadonlyArray<{ status?: string | null; appointmentId?: string | null; visitDate: Date }>,
): HojaDeControlDelCaso[] {
  return hojas
    .filter((h) => h.status === "SIGNED")
    .map((h) => ({ appointmentId: h.appointmentId ?? null, visitDate: h.visitDate }));
}

/** El paciente llegó a la clínica, aunque la consulta no haya terminado. */
const VINO = new Set(["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT"]);
/** La cita ya terminó: no puede ser «la próxima». */
const TERMINADA = new Set(["COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW"]);

/** El día de calendario de un instante, en la zona dada: "YYYY-MM-DD". */
function diaEnZona(instante: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/**
 * La cita ya se puede contar como control ocurrido. Una cita cuya hora aún no
 * llega también cuenta si es de HOY y el paciente ya vino o ya tiene su hoja:
 * al firmar la hoja de un control agendado a las 19:00, ws1-t8 la marca
 * atendida a las 16:00, y antes quedaba fuera («Asistencia —, sin controles
 * registrados» con la hoja a la vista).
 */
function citaYaOcurrio(
  c: CitaDeControlDelCaso,
  conHoja: ReadonlySet<string>,
  ahora: Date,
  zona: string,
): boolean {
  if (c.startsAt <= ahora) return true;
  if (!VINO.has(c.status) && !conHoja.has(c.id)) return false;
  return diaEnZona(c.startsAt, zona) <= diaEnZona(ahora, zona);
}

/** Zona por omisión si quien llama no la pasa (la de casi todas las clínicas). */
const ZONA_POR_OMISION = "America/Mexico_City";

function hace(ahora: Date, meses: number): Date {
  const d = new Date(ahora.getTime());
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d;
}

export interface AsistenciaDelCaso {
  /** `null` = todavía no hay ningún control del que se sepa si vino o no. */
  pct: number | null;
  asistio: number;
  falto: number;
}

/**
 * A cuántos controles vino, de los que ya ocurrieron en la ventana.
 *
 * Cuenta como «vino» una cita en la que el paciente llegó, o una cita con su
 * hoja de control registrada aunque nadie la marcara como atendida, o una hoja
 * registrada sin cita. Cuenta como falta la cita marcada «No asistió». Una
 * cita pasada que nadie marcó y que no tiene hoja NO cuenta ni a favor ni en
 * contra: no se sabe si vino. Las canceladas tampoco cuentan.
 */
export function asistenciaDelCaso(
  citas: readonly CitaDeControlDelCaso[],
  hojas: readonly HojaDeControlDelCaso[],
  ahora: Date,
  meses: number = MESES_DE_ASISTENCIA,
  zona: string = ZONA_POR_OMISION,
): AsistenciaDelCaso {
  const desde = hace(ahora, meses);
  const conHoja = new Set(hojas.flatMap((h) => (h.appointmentId ? [h.appointmentId] : [])));
  let asistio = 0;
  let falto = 0;
  for (const c of citas) {
    if (!citaYaOcurrio(c, conHoja, ahora, zona) || c.startsAt < desde) continue;
    if (c.status === "CANCELLED") continue;
    if (c.status === "NO_SHOW") falto += 1;
    else if (VINO.has(c.status) || conHoja.has(c.id)) asistio += 1;
  }
  for (const h of hojas) {
    if (h.appointmentId) continue;
    if (h.visitDate > ahora || h.visitDate < desde) continue;
    asistio += 1;
  }
  const total = asistio + falto;
  return { pct: total === 0 ? null : Math.round((asistio / total) * 100), asistio, falto };
}

export interface VisitasDelCaso {
  /** Controles a los que vino, en toda la vida del caso. */
  total: number;
  /** El más reciente, o `null` si no hay ninguno. */
  ultima: Date | null;
  /** El primero, para decir «desde jul 2026». */
  primera: Date | null;
}

/**
 * Los controles a los que el paciente SÍ vino. Una cita atendida y su hoja son
 * la misma visita, no dos; tampoco lo son dos hojas sueltas del mismo día.
 */
export function visitasDelCaso(
  citas: readonly CitaDeControlDelCaso[],
  hojas: readonly HojaDeControlDelCaso[],
  ahora: Date,
  zona: string,
): VisitasDelCaso {
  const conHoja = new Set(hojas.flatMap((h) => (h.appointmentId ? [h.appointmentId] : [])));
  const visitas: Date[] = [];
  const diasContados = new Set<string>();
  for (const c of citas) {
    if (!citaYaOcurrio(c, conHoja, ahora, zona)) continue;
    if (c.status === "CANCELLED" || c.status === "NO_SHOW") continue;
    if (!VINO.has(c.status) && !conHoja.has(c.id)) continue;
    visitas.push(c.startsAt);
    diasContados.add(diaEnZona(c.startsAt, zona));
  }
  for (const h of hojas) {
    if (h.appointmentId || h.visitDate > ahora) continue;
    const dia = diaEnZona(h.visitDate, zona);
    // La hoja suelta de un día que ya tiene su visita contada es esa misma visita.
    if (diasContados.has(dia)) continue;
    diasContados.add(dia);
    visitas.push(h.visitDate);
  }
  if (visitas.length === 0) return { total: 0, ultima: null, primera: null };
  visitas.sort((a, b) => a.getTime() - b.getTime());
  return { total: visitas.length, ultima: visitas[visitas.length - 1], primera: visitas[0] };
}

/**
 * La próxima cita de control: la primera que sigue en pie de HOY en adelante.
 * Una cita de hoy cuya hora ya pasó sigue siendo «la de hoy» mientras nadie la
 * cierre; una de ayer que se quedó sin marcar, no.
 */
export function proximaCitaDelCaso<T extends CitaDeControlDelCaso>(
  citas: readonly T[],
  ahora: Date,
  zona: string,
): T | null {
  const hoy = diaEnZona(ahora, zona);
  let mejor: T | null = null;
  for (const c of citas) {
    if (TERMINADA.has(c.status)) continue;
    const esFutura = c.startsAt >= ahora;
    const esDeHoy = diaEnZona(c.startsAt, zona) === hoy;
    if (!esFutura && !esDeHoy) continue;
    if (!mejor || c.startsAt < mejor.startsAt) mejor = c;
  }
  return mejor;
}

export interface UsoDeElasticos {
  /** `null` = nadie ha registrado nada en la ventana. */
  pct: number | null;
  diasRegistrados: number;
  ventanaDias: number;
  metaHoras: number;
}

/** El cumplimiento de la ventana, con la misma cuenta que el panel de la ficha y el portal. */
export function usoDeElasticos(
  registros: readonly ElasticsLogEntry[],
  ventanaDias: number = VENTANA_ELASTICOS_DIAS,
  metaHoras: number = META_ELASTICOS_HORAS,
): UsoDeElasticos {
  if (registros.length === 0) return { pct: null, diasRegistrados: 0, ventanaDias, metaHoras };
  const r = summarizeElasticsCompliance([...registros], { windowDays: ventanaDias, targetHoursPerDay: metaHoras });
  return {
    pct: r.compliancePct === null ? null : Math.round(r.compliancePct),
    diasRegistrados: r.loggedDays,
    ventanaDias,
    metaHoras,
  };
}
