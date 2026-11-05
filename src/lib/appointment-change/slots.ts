// Lógica compartida de slots para cambios de cita del portal del paciente
// (WS1-T5). La usan:
//   - GET  /api/paciente/appointments/[id]/slots          (portal: ver horarios)
//   - POST /api/paciente/appointments/[id]/change-request (portal: auto-aprobar)
//   - POST /api/appointment-change-requests/[id]/resolve  (clínica: aprobar)
//
// CONTRATO (no cambiar firmas — otros módulos ya importan esto):
//   CHANGEABLE_STATUSES: string[]
//     Estados de cita que el paciente puede cambiar: ["PENDING","SCHEDULED","CONFIRMED"]
//   buildDaySlots(openTime: string, closeTime: string, stepMin?: number): string[]
//     Slots "HH:mm" entre apertura y cierre (default 30 min).
//   canPatientChange(startsAt: Date, minHours: number, now?: Date): boolean
//     true si la cita está a más de minHours horas de distancia (ventana mínima).
//   isSlotFree(opts: { clinicId: string; doctorId: string | null; resourceId?: string | null;
//     startsAt: Date; endsAt: Date; excludeAppointmentId?: string }): Promise<boolean>
//     true si NO hay cita del doctor que se traslape (status notIn CANCELLED/NO_SHOW).
//     Sin doctor (ws1-t10), solo su sillón.
//
// Aquí vivía `clearAutoRemindersForAppointment`, que BORRABA los recordatorios
// de la cita —pendientes y enviados— y dejaba que el barrido re-encolara. Se
// retiró en M-22: borrar los enviados destruía el historial y, sobre todo,
// dejaba sin efecto la respuesta del paciente, porque el webhook empareja el
// "CONFIRMAR"/"CANCELAR" contra la fila SENT del recordatorio que recibió.
// Su reemplazo es lib/reminders/reschedule.server.ts, que cancela solo los
// pendientes y encola los nuevos en la misma transacción que mueve la cita.

import { prisma } from "@/lib/prisma";
import { sinApartadoVencido } from "@/lib/agenda/apartado";

/** Estados de cita que el paciente puede pedir cambiar desde el portal. */
export const CHANGEABLE_STATUSES: string[] = ["PENDING", "SCHEDULED", "CONFIRMED"];

/**
 * Slots "HH:mm" entre apertura y cierre, cada `stepMin` minutos (default 30).
 * Igual que el booking público: el último candidato es el que aún cabe un paso
 * completo antes del cierre (cur + stepMin <= close).
 */
export function buildDaySlots(openTime: string, closeTime: string, stepMin: number = 30): string[] {
  const [openH, openM] = openTime.split(":").map(Number);
  const [closeH, closeM] = closeTime.split(":").map(Number);
  if ([openH, openM, closeH, closeM].some((n) => Number.isNaN(n)) || stepMin <= 0) {
    return [];
  }

  const slots: string[] = [];
  let cur = openH * 60 + openM;
  const close = closeH * 60 + closeM;
  while (cur + stepMin <= close) {
    slots.push(`${String(Math.floor(cur / 60)).padStart(2, "0")}:${String(cur % 60).padStart(2, "0")}`);
    cur += stepMin;
  }
  return slots;
}

/** true si la cita está a más de `minHours` horas de distancia (ventana mínima). */
export function canPatientChange(startsAt: Date, minHours: number, now: Date = new Date()): boolean {
  return startsAt.getTime() - now.getTime() > minHours * 3_600_000;
}

export interface IsSlotFreeOpts {
  clinicId: string;
  /** null = cita «Sin doctor» (ws1-t10): no ocupa a ningún doctor; cuenta solo su sillón. */
  doctorId: string | null;
  /** Sillón de la cita. Solo se mira sin doctor (con doctor, lo de siempre). */
  resourceId?: string | null;
  startsAt: Date;
  endsAt: Date;
  excludeAppointmentId?: string;
}

/**
 * Contra qué citas choca un hueco del portal: las del doctor de la cita, como
 * siempre. Una cita «Sin doctor» (ws1-t10) no ocupa a ningún doctor —
 * `doctorId: null` en Prisma es IS NULL y empataría con todas las demás «Sin
 * doctor», que no se bloquean entre sí—: choca solo por su sillón, como la
 * constraint `appt_resource_no_overlap`. Sin doctor ni sillón: con nada (null).
 */
export function quienOcupaElHueco(
  doctorId: string | null | undefined,
  resourceId: string | null | undefined,
): { doctorId: string } | { resourceId: string } | null {
  if (doctorId) return { doctorId };
  if (resourceId) return { resourceId };
  return null;
}

/**
 * true si NO hay cita del DOCTOR que se traslape con [startsAt, endsAt).
 * Misma query de overlap del PATCH de agenda (startsAt lt endsAt && endsAt gt
 * startsAt, status notIn CANCELLED/NO_SHOW) — NO igualdad exacta de hora.
 */
export async function isSlotFree(opts: IsSlotFreeOpts): Promise<boolean> {
  // (c) de la casa: sin clinicId no se consulta.
  if (!opts.clinicId) return false;
  const porQuien = quienOcupaElHueco(opts.doctorId, opts.resourceId);
  if (!porQuien) return true;
  const conflict = await prisma.appointment.findFirst({
    where: {
      clinicId: opts.clinicId,
      ...porQuien,
      ...(opts.excludeAppointmentId ? { id: { not: opts.excludeAppointmentId } } : {}),
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      startsAt: { lt: opts.endsAt },
      endsAt: { gt: opts.startsAt },
      // WS1-T5 — una cita apartada cuyo anticipo venció ya no ocupa el hueco.
      AND: [sinApartadoVencido()],
    },
    select: { id: true },
  });
  return conflict === null;
}

