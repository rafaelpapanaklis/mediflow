// «Hecho» pregunta en qué cita se hizo (v17, decisión 1 de Rafael, 28-oct-2026). PURO: lo usan la tarjeta
// del plan y el servidor.
//
//  · Al pulsar «Hecho» en la tarjeta sale la elección con las citas recientes del paciente, la de HOY
//    primero (`ordenarCitasParaHecho`). «Hoy en el sillón» no pregunta: la cita es la de esa consulta.
//  · «Se hizo sin cita» pide un motivo corto y obligatorio (`limpiarMotivoSinCita`); queda en la fila
//    hecha y en Movimientos.
//  · Si la cita elegida no tiene nota clínica, la pantalla AVISA y ofrece escribirla. Nunca bloquea el
//    «Hecho» ni el cobro.

export const MIN_MOTIVO_SIN_CITA = 3;
export const MAX_MOTIVO_SIN_CITA = 200;

/** El motivo de «Se hizo sin cita», limpio (espacios juntados), o null si no llega a lo mínimo. */
export function limpiarMotivoSinCita(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.replace(/\s+/g, " ").trim().slice(0, MAX_MOTIVO_SIN_CITA);
  return m.length >= MIN_MOTIVO_SIN_CITA ? m : null;
}

/** Una cita que se puede elegir para «Hecho» (GET /api/treatments/[id]/citas-para-hecho). */
export interface CitaParaHecho {
  id: string;
  /** ISO. */
  startsAt: string;
  status: string;
  /** «Dra. Ana López» (nombre y apellido del doctor de la cita), o null. */
  doctor: string | null;
  /** El motivo de la cita («Resina», «Limpieza»…), si lo tiene. */
  motivo: string | null;
  /** Es de hoy en la zona de la clínica. */
  esHoy: boolean;
  /** Tiene nota clínica con algo escrito (ligada por `specialtyData.appointmentId`). */
  tieneNota: boolean;
  /**
   * v18 (t5 de la v17, m2): quien pregunta puede escribir AHORA la nota ligada a esta cita
   * («Marcar y escribir la nota»; regla en `notaLigable`).
   */
  notaLigable: boolean;
}

/** Estados en los que una cita no respalda nada: no se pasó (cancelada) o el paciente no vino. */
const CITA_SIN_CONSULTA = ["CANCELLED", "NO_SHOW"];
/** La consulta de la cita ya se cerró. */
const CITA_TERMINADA = ["COMPLETED", "CHECKED_OUT"];

/** Cuándo es la cita respecto de hoy, en la zona de la clínica. */
export type MomentoDeLaCita = "pasado" | "hoy" | "futuro";

/**
 * v18 (t5 de la v17, m2): ¿se puede ligar EXPLÍCITAMENTE una nota nueva de `quienEscribe` a esta cita
 * («Marcar y escribir la nota»)? Sí aunque sea de otro día o de otro doctor, salvo:
 *  · cancelada, «no vino» o de un día que aún no llega;
 *  · la cita de HOY de OTRO doctor que aún no termina (por atender, en sala o en consulta): esa consulta la
 *    escribe y la firma su doctor. «Completar consulta» firma la nota más reciente de la cita y «Nueva
 *    consulta» adopta el borrador de la cita: otra nota ligada antes le cambiaría cuál firma, o dejaría la
 *    suya suelta («una cita, una nota»).
 * El servidor exige además misma clínica y paciente, y algo del plan marcado «Hecho» en esa cita.
 */
export function notaLigable(cita: { status: string; doctorId: string | null; momento: MomentoDeLaCita }, quienEscribe: string): boolean {
  if (CITA_SIN_CONSULTA.includes(cita.status) || cita.momento === "futuro") return false;
  if (cita.doctorId === quienEscribe) return true;
  return CITA_TERMINADA.includes(cita.status) || cita.momento === "pasado";
}

/** Las de hoy primero (en orden de hora); después las demás, de la más reciente a la más vieja. */
export function ordenarCitasParaHecho<T extends Pick<CitaParaHecho, "startsAt" | "esHoy">>(citas: readonly T[]): T[] {
  const t = (c: T) => Date.parse(c.startsAt) || 0;
  return [
    ...citas.filter((c) => c.esHoy).sort((a, b) => t(a) - t(b)),
    ...citas.filter((c) => !c.esHoy).sort((a, b) => t(b) - t(a)),
  ];
}

/** Lo que la tarjeta manda en el PATCH según lo elegido: la cita, o «sin cita» con su motivo. */
export type EleccionDeCita = { citaId: string } | { sinCita: true; motivo: string };
