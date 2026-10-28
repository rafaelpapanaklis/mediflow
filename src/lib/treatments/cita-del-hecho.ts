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
