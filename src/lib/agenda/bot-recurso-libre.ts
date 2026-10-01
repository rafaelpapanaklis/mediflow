import { validateResourceSchedule } from "./resource-schedule";
import { TREATMENT_KINDS } from "./types";
import type { WeekScheduleDTO } from "./types";

/**
 * ws1-t1 (#13) — sillones del bot de WhatsApp. PURO (sin Prisma): lo usan
 * `getAvailableSlots` (no ofrecer un hueco sin sillón libre) y
 * `createBotAppointment` / `rescheduleBotAppointment` (crear la cita EN un
 * sillón libre). Antes el bot creaba con `resourceId: null` y solo miraba la
 * agenda del doctor: con dos doctores y un sillón ofrecía la misma hora a los dos.
 *
 * «La clínica usa sillones» = tiene al menos un recurso ACTIVO de tratamiento
 * (sillón o consultorio; los legacy CHAIR también cuentan). Sala de espera,
 * radiografía y laboratorio no son lugares donde se atienda una cita. Sin
 * ninguno, todo queda exactamente como antes (resourceId null).
 */

/** Kinds en los que el bot puede sentar una cita. */
export const KINDS_AGENDABLES_POR_BOT: readonly string[] = [...TREATMENT_KINDS, "CHAIR"];

export interface RecursoAgendable {
  id: string;
  /** null = sin horario propio = siempre abierto (igual que en la agenda). */
  schedule: WeekScheduleDTO | null;
}

export interface CitaEnRecurso {
  resourceId: string | null;
  startsAt: Date;
  endsAt: Date;
}

/**
 * El primer sillón libre de `inicio` a `fin`: dentro de su horario y sin otra
 * cita encima. `preferido` (el sillón que la cita ya tenía al reagendar) gana
 * si está libre. Los recursos van en el orden de la agenda (orderIndex).
 * Devuelve null si ninguno está libre.
 */
export function recursoLibre(
  recursos: RecursoAgendable[],
  citas: CitaEnRecurso[],
  inicio: Date,
  fin: Date,
  timezone: string,
  preferido?: string | null,
): string | null {
  const s = inicio.getTime();
  const e = fin.getTime();
  const libre = (r: RecursoAgendable): boolean => {
    if (!validateResourceSchedule(inicio, fin, r.schedule, timezone).ok) return false;
    return !citas.some(
      (c) => c.resourceId === r.id && s < c.endsAt.getTime() && e > c.startsAt.getTime(),
    );
  };
  const orden = preferido
    ? [...recursos.filter((r) => r.id === preferido), ...recursos.filter((r) => r.id !== preferido)]
    : recursos;
  return orden.find(libre)?.id ?? null;
}
