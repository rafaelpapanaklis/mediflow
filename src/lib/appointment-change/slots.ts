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
//   isSlotFree(opts: { clinicId: string; doctorId: string; startsAt: Date; endsAt: Date;
//     excludeAppointmentId?: string }): Promise<boolean>
//     true si NO hay cita del doctor que se traslape (status notIn CANCELLED/NO_SHOW).
//   clearAutoRemindersForAppointment(appointmentId: string): Promise<void>
//     Best-effort (nunca lanza): borra los recordatorios automáticos
//     (WhatsAppReminder type APPT_AUTO) de la cita — pendientes Y enviados,
//     porque referencian la hora vieja y bloquean el dedup del sweep — para
//     que /api/cron/appointment-reminders re-encole con la nueva hora.

import { prisma } from "@/lib/prisma";
import { APPT_AUTO_TYPE } from "@/lib/reminders/config";

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
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  excludeAppointmentId?: string;
}

/**
 * true si NO hay cita del DOCTOR que se traslape con [startsAt, endsAt).
 * Misma query de overlap del PATCH de agenda (startsAt lt endsAt && endsAt gt
 * startsAt, status notIn CANCELLED/NO_SHOW) — NO igualdad exacta de hora.
 */
export async function isSlotFree(opts: IsSlotFreeOpts): Promise<boolean> {
  const conflict = await prisma.appointment.findFirst({
    where: {
      clinicId: opts.clinicId,
      doctorId: opts.doctorId,
      ...(opts.excludeAppointmentId ? { id: { not: opts.excludeAppointmentId } } : {}),
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      startsAt: { lt: opts.endsAt },
      endsAt: { gt: opts.startsAt },
    },
    select: { id: true },
  });
  return conflict === null;
}

/**
 * Borra los recordatorios automáticos (type APPT_AUTO) de la cita para que el
 * sweep re-encole con la nueva hora. Borra pendientes Y enviados: las filas
 * SENT también referencian la hora vieja y su sola existencia bloquea el
 * dedup cita+momento+canal de src/lib/reminders/enqueue.ts.
 * Best-effort: try/catch interno, NUNCA lanza.
 */
export async function clearAutoRemindersForAppointment(appointmentId: string): Promise<void> {
  try {
    await prisma.whatsAppReminder.deleteMany({
      where: { appointmentId, type: APPT_AUTO_TYPE },
    });
  } catch (err) {
    console.error("[appointment-change] clearAutoRemindersForAppointment error:", err);
  }
}
