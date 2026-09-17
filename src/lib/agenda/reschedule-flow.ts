/**
 * Mover una cita arrastrándola — la lógica ÚNICA que usan las dos agendas.
 *
 * Vivía dentro de `AgendaShell` (`agenda-page-client.tsx`), en sus tres
 * manejadores de dnd-kit: al mover, al soltar y al confirmar. La agenda nueva
 * necesita exactamente lo mismo, y copiarlo es el error de
 * `bot-booking-service.ts`, que copió las reglas de agendar y hoy le faltan
 * siete validaciones. Así que sale de ahí sin cambiar ni una coma de lo que
 * hace, y las DOS agendas lo llaman:
 *
 *   1. `planReschedule` — dónde caería la cita: la columna de destino dice
 *      doctor, sillón o día; el desplazamiento vertical, la hora (redondeada
 *      al hueco de la clínica con `recomputeTimes`). Y si no se movió o si
 *      choca con otra cita del mismo doctor o sillón (`detectOverlap`).
 *   2. `reschedulePayload` — lo que viaja al servidor: solo lo que cambió.
 *   3. `commitReschedule` — el movimiento optimista, el PATCH de siempre
 *      (`rescheduleAppointment`) y, si el servidor dice que no, la vuelta
 *      atrás (`ROLLBACK_RESCHEDULE`). Nunca queda una cita pintada en el
 *      hueco nuevo mientras en la base sigue en el viejo.
 *
 * Lo que NO está aquí: qué se le dice a la persona. Cada agenda redacta su
 * aviso con el error que devuelve `commitReschedule`; la de siempre conserva
 * sus frases al pie de la letra.
 *
 * Sin React ni `fetch` directo: el despachador y la llamada al servidor se
 * inyectan, y así las pruebas lo ejercitan con el reductor de verdad.
 */

import { calendarDayISO } from "./date-ranges";
import { detectOverlap, recomputeTimes, type DroppableData } from "./drag-utils";
import {
  rescheduleAppointment,
  type RescheduleAppointmentInput,
  type RescheduleAppointmentResult,
  type ScheduleWarningDTO,
} from "./mutations";
import type { AgendaAction } from "./store";
import type { AgendaAppointmentDTO } from "./types";

/** Distancia (px) que hay que arrastrar antes de que un clic cuente como arrastre. */
export const DRAG_ACTIVATION_DISTANCE_PX = 6;

export interface ReschedulePlan {
  original: AgendaAppointmentDTO;
  newStartsAt: string;
  newEndsAt: string;
  newDoctorId: string | null;
  newResourceId: string | null;
  /** Día calendario de destino (distinto del de origen solo al soltar en otro día). */
  toDayISO: string;
}

export interface PlannedReschedule extends ReschedulePlan {
  /** Soltó donde ya estaba: misma hora, mismo doctor y mismo sillón. */
  unchanged: boolean;
  /** Choca con otra cita viva del mismo doctor o del mismo sillón. */
  overlap: boolean;
}

export interface PlanRescheduleInput {
  original: AgendaAppointmentDTO;
  /** El `data` del droppable sobre el que está (o se soltó) la cita. */
  target: DroppableData;
  /** Desplazamiento vertical desde que empezó el arrastre, en px. */
  deltaY: number;
  /** Alto de un hueco de la clínica en px, el MISMO con el que se pinta la rejilla. */
  slotHpx: number;
  slotMinutes: number;
  /** Hora en que empieza la rejilla dibujada. */
  dayStart: number;
  /** Hora en que termina la rejilla dibujada. */
  dayEnd: number;
  /** El día que se está mirando: destino por defecto cuando la columna no es un día. */
  currentDayISO: string;
  timezone: string;
  appointments: AgendaAppointmentDTO[];
}

/** El destino que dice la columna: doctor, sillón o día. Lo demás se conserva. */
export function resolveDropTarget(
  original: AgendaAppointmentDTO,
  target: DroppableData,
  currentDayISO: string,
): { newDoctorId: string | null; newResourceId: string | null; toDayISO: string } {
  let toDayISO = currentDayISO;
  let newDoctorId = original.doctor?.id ?? null;
  let newResourceId = original.resourceId;
  if (target.kind === "doctor-col") newDoctorId = target.doctorId;
  else if (target.kind === "resource-col") newResourceId = target.resourceId;
  else if (target.kind === "day-col") toDayISO = target.dayISO;
  return { newDoctorId, newResourceId, toDayISO };
}

export function planReschedule(input: PlanRescheduleInput): PlannedReschedule {
  const { original } = input;
  const currentDoctorId = original.doctor?.id ?? null;
  const currentResourceId = original.resourceId;
  const { newDoctorId, newResourceId, toDayISO } = resolveDropTarget(
    original,
    input.target,
    input.currentDayISO,
  );

  const result = recomputeTimes({
    appt: original,
    deltaY: input.deltaY,
    slotHpx: input.slotHpx,
    slotMinutes: input.slotMinutes,
    dayStart: input.dayStart,
    dayEnd: input.dayEnd,
    fromDayISO: calendarDayISO(original.startsAt, input.timezone),
    toDayISO,
    timezone: input.timezone,
  });

  const unchanged =
    original.startsAt === result.startsAt &&
    (original.endsAt ?? "") === result.endsAt &&
    newDoctorId === currentDoctorId &&
    newResourceId === currentResourceId;

  const overlap = detectOverlap(
    input.appointments,
    original.id,
    result.startsAt,
    result.endsAt,
    newDoctorId,
    newResourceId,
  );

  return {
    original,
    newStartsAt: result.startsAt,
    newEndsAt: result.endsAt,
    newDoctorId,
    newResourceId,
    toDayISO,
    unchanged,
    overlap,
  };
}

/** El cuerpo del PATCH: las horas siempre; doctor y sillón solo si cambiaron. */
export function reschedulePayload(plan: ReschedulePlan): RescheduleAppointmentInput {
  const currentDoctorId = plan.original.doctor?.id ?? null;
  const currentResourceId = plan.original.resourceId;
  const payload: RescheduleAppointmentInput = {
    startsAt: plan.newStartsAt,
    endsAt: plan.newEndsAt,
  };
  if (plan.newDoctorId !== currentDoctorId && plan.newDoctorId) payload.doctorId = plan.newDoctorId;
  if (plan.newResourceId !== currentResourceId) payload.resourceId = plan.newResourceId;
  return payload;
}

/** El doctor con el que se pinta la cita mientras el servidor contesta. */
export function optimisticDoctorIdOf(plan: ReschedulePlan): string {
  return plan.newDoctorId ?? plan.original.doctor?.id ?? "";
}

// Los campos de la otra rama van como `?: undefined` a propósito: el repo
// compila con `strict: false`, y ahí `if (r.ok)` no estrecha la unión.
export type CommitRescheduleResult =
  | {
      ok: true;
      appointment: AgendaAppointmentDTO;
      scheduleWarning: ScheduleWarningDTO | null;
      error?: undefined;
    }
  | {
      ok: false;
      /** Lo que lanzó la llamada: un `ApiError` si contestó el servidor, o el fallo de red. */
      error: unknown;
      appointment?: undefined;
      scheduleWarning?: undefined;
    };

export interface CommitRescheduleDeps {
  dispatch: (action: AgendaAction) => void;
  /** Por defecto, el PATCH de siempre. Se inyecta en las pruebas. */
  reschedule?: (
    id: string,
    input: RescheduleAppointmentInput,
  ) => Promise<RescheduleAppointmentResult>;
}

/**
 * Mueve la cita en pantalla, se lo pide al servidor y, si el servidor dice que
 * no, la devuelve a su sitio. No lanza nunca: el rechazo viaja en el resultado.
 */
export async function commitReschedule(
  plan: ReschedulePlan,
  deps: CommitRescheduleDeps,
): Promise<CommitRescheduleResult> {
  const { original } = plan;

  deps.dispatch({
    type: "OPTIMISTIC_RESCHEDULE",
    id: original.id,
    doctorId: optimisticDoctorIdOf(plan),
    resourceId: plan.newResourceId,
    startsAt: plan.newStartsAt,
    endsAt: plan.newEndsAt,
  });

  const reschedule = deps.reschedule ?? rescheduleAppointment;
  try {
    const { appointment, scheduleWarning } = await reschedule(original.id, reschedulePayload(plan));
    deps.dispatch({ type: "REPLACE_APPOINTMENT", appointment });
    return { ok: true, appointment, scheduleWarning };
  } catch (error) {
    deps.dispatch({ type: "ROLLBACK_RESCHEDULE", original });
    return { ok: false, error };
  }
}
