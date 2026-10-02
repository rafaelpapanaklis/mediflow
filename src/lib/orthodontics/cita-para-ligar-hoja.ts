// ws1-t8 (revisión final de ws1-t9, fallo nuevo 2): a QUÉ cita de hoy se liga la hoja firmada «sin cita».
//
// Antes, sin consulta en curso, la acción tomaba la PRIMERA cita de hoy del paciente (`orderBy startsAt asc`):
// P0147 con 14:00 (Dra. Cortés) y 15:00 (el doctor en sesión), la ficha abierta con `?appointment=<15:00>` →
// «Ver el control de hoy (firmado)» ligó y COMPLETÓ la de 14:00, de otra doctora, y la de 15:00 siguió
// «Agendada». Ahora:
//   1. Si la hoja se abrió desde una cita (consulta en curso o `?appointment=`), es ESA o ninguna: nunca otra
//      del mismo día en su lugar.
//   2. Si no, la primera cita de control de hoy aún pendiente.
// La misma regla elige la cita de una hoja NUEVA abierta desde la ficha (getTreatmentCardContextForPatient).
// En los dos casos, solo una cita que la sesión puede mover (un doctor, las suyas: esCitaQuePuedeMover).
import { esCitaControlOrto } from "@/lib/orthodontics/agenda-constants";
import { esCitaQuePuedeMover } from "@/lib/agenda/cita-del-usuario";

const ANULADA = new Set(["CANCELLED", "NO_SHOW"]);
const ATENDIDA = new Set(["COMPLETED", "CHECKED_OUT"]);

export interface CitaDeHoyParaLigar {
  id: string;
  type: string | null;
  status: string;
  startsAt: Date;
  doctorId: string | null;
}

export function citaParaLigarLaHoja<T extends CitaDeHoyParaLigar>(
  citasDeHoy: readonly T[],
  citaPedidaId: string | null | undefined,
  usuario: { id: string; role?: string | null },
  /** La hoja NUEVA de la ficha también se liga a una cita de hoy ya atendida (getTreatmentCardContextForPatient);
   *  ligar una hoja YA firmada, no (no hay nada que cerrar). */
  opts: { incluirAtendidas?: boolean } = {},
): T | null {
  const tocable = (c: T) =>
    !ANULADA.has(c.status) && (opts.incluirAtendidas || !ATENDIDA.has(c.status)) && esCitaQuePuedeMover(c, usuario);
  if (citaPedidaId) {
    const pedida = citasDeHoy.find((c) => c.id === citaPedidaId);
    return pedida && tocable(pedida) ? pedida : null;
  }
  const candidatas = citasDeHoy
    .filter((c) => tocable(c) && esCitaControlOrto(c.type))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return candidatas[0] ?? null;
}
