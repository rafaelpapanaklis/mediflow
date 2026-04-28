import {
  slotIndexToUtc,
  timeToSlotIndex,
  type ClinicTimeConfig,
} from "./time-utils";
import type { AgendaAppointmentDTO } from "./types";

/**
 * Altura en píxeles de un slot único en la grid del día.
 * Definido en agenda.module.css como `--mf-agenda-slot-h: 30px`.
 * Si cambia el CSS, actualiza este valor.
 */
export const SLOT_HPX = 30;

export interface DragSnapInput {
  appt: AgendaAppointmentDTO;
  /** Pixel delta vertical desde el inicio del drag. */
  deltaY: number;
  slotMinutes: number;
  dayStart: number;
  dayEnd: number;
  /** dayISO de origen (donde la cita está actualmente). */
  fromDayISO: string;
  /** dayISO de destino (puede coincidir con fromDayISO en vista día). */
  toDayISO: string;
  timezone: string;
}

export interface DragSnapResult {
  startsAt: string;
  endsAt: string;
  startSlot: number;
  durationSlots: number;
  durationMin: number;
}

/**
 * Recalcula startsAt/endsAt aplicando un delta vertical en píxeles, snapeando
 * al slot más cercano. Mantiene la duración original. Limita el resultado al
 * rango operativo del día [dayStart, dayEnd].
 */
export function recomputeTimes(input: DragSnapInput): DragSnapResult {
  const { appt, deltaY, slotMinutes, dayStart, dayEnd, fromDayISO, toDayISO, timezone } = input;
  const config: ClinicTimeConfig = { timezone, slotMinutes, dayStart, dayEnd };

  const startMs = new Date(appt.startsAt).getTime();
  const endMs = appt.endsAt
    ? new Date(appt.endsAt).getTime()
    : startMs + slotMinutes * 60_000;
  const durationMin = Math.max(slotMinutes, (endMs - startMs) / 60_000);
  const durationSlots = Math.max(1, Math.ceil(durationMin / slotMinutes));

  const totalSlots = Math.floor(((dayEnd - dayStart) * 60) / slotMinutes);
  const originalSlotRaw = timeToSlotIndex(appt.startsAt, fromDayISO, config);
  const originalSlot = originalSlotRaw < 0 ? 0 : originalSlotRaw;

  const deltaSlots = Math.round(deltaY / SLOT_HPX);
  const rawSlot = originalSlot + deltaSlots;
  const newSlot = Math.max(0, Math.min(totalSlots - durationSlots, rawSlot));

  const newStart = slotIndexToUtc(newSlot, toDayISO, config);
  const newEnd = new Date(newStart.getTime() + durationMin * 60_000);

  return {
    startsAt: newStart.toISOString(),
    endsAt: newEnd.toISOString(),
    startSlot: newSlot,
    durationSlots,
    durationMin,
  };
}

/**
 * Detecta solapamiento de tiempo con otra cita activa que comparta doctor o
 * recurso con el destino. Excluye la cita arrastrada y las CANCELLED/NO_SHOW.
 */
export function detectOverlap(
  appointments: AgendaAppointmentDTO[],
  draggedId: string,
  newStartsAt: string,
  newEndsAt: string,
  doctorId: string | null,
  resourceId: string | null,
): boolean {
  const newStart = new Date(newStartsAt).getTime();
  const newEnd = new Date(newEndsAt).getTime();
  for (const a of appointments) {
    if (a.id === draggedId) continue;
    if (a.status === "CANCELLED" || a.status === "NO_SHOW") continue;
    if (!a.endsAt) continue;
    const aDoctorId = a.doctor?.id ?? null;
    const sameDoctor = doctorId !== null && aDoctorId === doctorId;
    const sameResource = resourceId !== null && a.resourceId === resourceId;
    if (!sameDoctor && !sameResource) continue;
    const aStart = new Date(a.startsAt).getTime();
    const aEnd = new Date(a.endsAt).getTime();
    if (aStart < newEnd && aEnd > newStart) return true;
  }
  return false;
}

/* ─── Tipos compartidos para data() de useDraggable / useDroppable ─── */

export type AppointmentDragData = {
  kind: "appt";
  appointmentId: string;
};

export type DroppableData =
  | {
      kind: "doctor-col";
      columnKey: string;
      doctorId: string;
      resourceId: null;
    }
  | {
      kind: "resource-col";
      columnKey: string;
      doctorId: null;
      resourceId: string;
    }
  | {
      kind: "unified-col";
      columnKey: string;
      doctorId: null;
      resourceId: null;
    }
  | {
      kind: "day-col";
      dayISO: string;
    };
