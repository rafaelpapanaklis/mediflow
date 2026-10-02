// M6 (ws1-t8, ronda 6): firmar la hoja de control cierra la cita en la Agenda.
// Verificado en vivo: desde «Agendada» la máquina de estados NO permite ir
// directo a «Completada» (solo desde en sillón / en consulta), así que la cita
// se quedaba en «Agendada» y el arreglo no hacía nada. Si la cita todavía no
// arrancó, se pasa por «En consulta» (el doctor sí atendió: firmó la hoja),
// respetando el rol y la máquina de estados de siempre.
import { canTransition, sideEffectsOf } from "@/lib/agenda/transitions";

type Estado = Parameters<typeof canTransition>[0];
type Rol = Parameters<typeof canTransition>[2];

export type PlanDeCierre =
  | { accion: "nada" }
  | { accion: "completar"; pasaPorEnConsulta: boolean };

export function planDeCierreDeCita(
  estado: string,
  rol: string,
  ahora: Date,
  inicio: Date,
): PlanDeCierre {
  if (estado === "COMPLETED") return { accion: "nada" };
  const from = estado as Estado;
  const r = rol as Rol;
  if (canTransition(from, "COMPLETED", r, ahora, inicio).ok) {
    return { accion: "completar", pasaPorEnConsulta: false };
  }
  if (
    canTransition(from, "IN_PROGRESS", r, ahora, inicio).ok &&
    canTransition("IN_PROGRESS", "COMPLETED", r, ahora, inicio).ok
  ) {
    return { accion: "completar", pasaPorEnConsulta: true };
  }
  return { accion: "nada" };
}

/** Campos a escribir en la cita según el plan (vacío si no hay que tocarla). */
export function datosDeCierreDeCita(plan: PlanDeCierre, ahora: Date) {
  if (plan.accion === "nada") return null;
  return {
    status: "COMPLETED" as const,
    ...(plan.pasaPorEnConsulta ? sideEffectsOf("IN_PROGRESS", ahora) : {}),
    ...sideEffectsOf("COMPLETED", ahora),
  };
}

// ── ws1-t8 (ticket BEVADENT, punto 12): firmar HOY la hoja de una cita de OTRO día ─────────
//
// Antes, firmar la hoja ligada a una cita futura la pasaba a «Atendida» antes de que ocurriera y la
// visita quedaba con la fecha futura («último control» en el futuro, paciente «sin próximo control»).
// La regla, igual para todos los roles clínicos:
//   · Cita de hoy o de un día pasado: como siempre (se liga, la visita lleva su fecha y se cierra).
//   · Cita de un día FUTURO con el paciente ya presente (llegó, en sillón, en consulta): se atendió
//     hoy, adelantada. Se liga y se cierra, pero la visita lleva la fecha de HOY.
//   · Cita de un día FUTURO sin el paciente presente (agendada, confirmada…): NO se toca. La hoja se
//     firma como visita de hoy, sin cita, y se avisa para que recepción decida qué hacer con esa cita.

/** Estados en los que el paciente ya está en la clínica para ESA cita. */
const PACIENTE_PRESENTE = new Set(["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"]);

/** «2026-10-06», el día de calendario de `d` en la zona de la clínica. */
export function diaEnZona(d: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export type CitaAlFirmar =
  /** La hoja se liga a la cita y se intenta cerrar; `visitaHoy` = la visita lleva la fecha de hoy, no la de la cita. */
  | { ligar: true; visitaHoy: boolean }
  /** Cita de un día futuro sin el paciente presente: no se liga ni se toca; la visita es de hoy. */
  | { ligar: false; visitaHoy: true; diaDeLaCita: string };

export function citaAlFirmar(cita: { status: string; startsAt: Date }, ahora: Date, zona: string): CitaAlFirmar {
  const diaCita = diaEnZona(cita.startsAt, zona);
  if (diaCita <= diaEnZona(ahora, zona)) return { ligar: true, visitaHoy: false };
  if (PACIENTE_PRESENTE.has(cita.status)) return { ligar: true, visitaHoy: true };
  return { ligar: false, visitaHoy: true, diaDeLaCita: diaCita };
}
