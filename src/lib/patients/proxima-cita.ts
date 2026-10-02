// ws1-t8 (revisión en panel.108 de ws1-t9, fallo 1): la cita con la que se ATIENDE desde la ficha —
// «Próxima cita» de la cabecera, «Iniciar consulta» y el «Iniciar visita» de Ortodoncia.
//
// La ficha recibe las citas de la MÁS LEJANA a la más vieja (`startsAt: desc`) y antes hacía
// `find(a => new Date(a.date) >= new Date())`: la primera futura de una lista descendente es la más
// LEJANA, y `a.date` es el día sin hora («2026-10-02» = medianoche UTC), así que la de hoy nunca
// entraba. Con citas el 2, 5 y 7 de octubre la cabecera decía «7 oct» y el botón empujaba esa cita.
//
// La regla, en este orden:
//   1. Una cita en la que el paciente YA está (llegó, en sillón, en consulta): es la que se atiende.
//   2. Una cita de HOY (día de la clínica) aún sin atender, aunque su hora ya haya pasado: la más temprana.
//   3. La futura más próxima.
// Nunca una atendida, cancelada o con inasistencia, ni una de un día pasado que quedó sin cerrar.

import { canTransition, type UserRole } from "@/lib/agenda/transitions";
import type { AppointmentStatus } from "@/lib/agenda/types";
import { esCitaQuePuedeMover } from "@/lib/agenda/cita-del-usuario";

const YA_NO_PENDIENTE =new Set(["COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW"]);
const PACIENTE_PRESENTE = new Set(["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"]);

function diaEnZona(d: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function proximaCitaDeLaFicha<T extends { status: string; startsAt: string | Date }>(
  citas: readonly T[],
  ahora: Date,
  zona: string,
): T | null {
  const hoy = diaEnZona(ahora, zona);
  let mejor: { cita: T; rango: number; inicio: number } | null = null;
  for (const cita of citas) {
    if (YA_NO_PENDIENTE.has(cita.status)) continue;
    const inicio = new Date(cita.startsAt);
    if (isNaN(inicio.getTime())) continue;
    const esDeHoy = diaEnZona(inicio, zona) === hoy;
    const rango = PACIENTE_PRESENTE.has(cita.status) ? 0 : esDeHoy ? 1 : inicio.getTime() >= ahora.getTime() ? 2 : -1;
    if (rango < 0) continue;
    if (!mejor || rango < mejor.rango || (rango === mejor.rango && inicio.getTime() < mejor.inicio)) {
      mejor = { cita, rango, inicio: inicio.getTime() };
    }
  }
  return mejor?.cita ?? null;
}

/** ¿La cita es de hoy en la zona de la clínica? (para decidir si «Iniciar consulta» la arranca). */
export function esCitaDeHoy(startsAt: string | Date, ahora: Date, zona: string): boolean {
  const inicio = new Date(startsAt);
  return !isNaN(inicio.getTime()) && diaEnZona(inicio, zona) === diaEnZona(ahora, zona);
}

// ws1-t8 (revisión final de ws1-t9, fallo nuevo 1): la cabecera proponía la cita de OTRO doctor (P0147: 14:00
// con la Dra. Cortés y 15:00 con el doctor en sesión) y «Iniciar consulta» moría con 403 `not_your_appointment`.
// Ahora «Iniciar consulta» solo propone una cita que la sesión puede arrancar — las mismas reglas que
// PATCH /status: sin «Editar/mover citas» nada; un doctor solo las suyas; y con la de HOY, que su rol pueda
// pasarla a «En consulta» (recepción no puede). Si no hay ninguna, el botón no se ofrece.

/**
 * ws1-t8 (decisión 6 de Rafael): «Iniciar consulta» pasa la cita a «En consulta» si es de HOY o de un día
 * FUTURO (el paciente de mañana llegó hoy: el servidor la trae a hoy, ver adelantar-cita-a-hoy.ts). Una de un
 * día pasado o ya «En consulta» no se toca.
 */
export function iniciarConsultaArrancaLaCita(cita: { status: string; startsAt: string | Date }, ahora: Date, zona: string): boolean {
  if (cita.status === "IN_PROGRESS") return false;
  const inicio = new Date(cita.startsAt);
  return !isNaN(inicio.getTime()) && diaEnZona(inicio, zona) >= diaEnZona(ahora, zona);
}

export interface QuienIniciaLaConsulta {
  id: string;
  role?: string | null;
  /** Permiso «agenda.edit» (lo resuelve el servidor; la ruta lo vuelve a exigir). */
  puedeEditarAgenda: boolean;
}

export type MotivoSinIniciar = "sinPermiso" | "deOtroProfesional";

export function motivoParaNoIniciar(
  cita: { status: string; startsAt: string | Date; doctorId?: string | null },
  quien: QuienIniciaLaConsulta,
  ahora: Date,
  zona: string,
): MotivoSinIniciar | null {
  if (!quien.puedeEditarAgenda) return "sinPermiso";
  // ws1-t8 (revisión de ws1-t9, fallo 2): un rol que NUNCA puede pasar una cita a «En consulta» (recepción)
  // tampoco inicia la de otro día. Antes solo se miraba con la de hoy y, con una cita futura, recepción veía
  // «Iniciar consulta» activo y abría `?appointment=`.
  const inicio = new Date(cita.startsAt);
  const rol = (quien.role ?? "") as UserRole;
  if (canTransition("CONFIRMED", "IN_PROGRESS", rol, ahora, inicio).code === "forbidden_role") return "sinPermiso";
  if (!esCitaQuePuedeMover(cita, quien)) return "deOtroProfesional";
  if (iniciarConsultaArrancaLaCita(cita, ahora, zona)) {
    if (!canTransition(cita.status as AppointmentStatus, "IN_PROGRESS", rol, ahora, inicio).ok) {
      return "sinPermiso";
    }
  }
  return null;
}

/**
 * La cita que «Iniciar consulta» propone: la de `proximaCitaDeLaFicha` entre las que la sesión puede arrancar.
 * `motivo` dice por qué no hay botón cuando el paciente SÍ tiene una próxima cita pero no es de quien mira.
 */
export function citaParaIniciarDesdeLaFicha<T extends { status: string; startsAt: string | Date; doctorId?: string | null }>(
  citas: readonly T[],
  quien: QuienIniciaLaConsulta,
  ahora: Date,
  zona: string,
): { cita: T | null; motivo: MotivoSinIniciar | null } {
  const propia = proximaCitaDeLaFicha(
    citas.filter((c) => motivoParaNoIniciar(c, quien, ahora, zona) === null),
    ahora,
    zona,
  );
  if (propia) return { cita: propia, motivo: null };
  const cualquiera = proximaCitaDeLaFicha(citas, ahora, zona);
  return { cita: null, motivo: cualquiera ? motivoParaNoIniciar(cualquiera, quien, ahora, zona) : null };
}
