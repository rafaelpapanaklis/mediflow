"use client";

import { useCallback, useMemo, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useAgenda } from "./agenda-provider";
import { AgendaAppointmentCard } from "./agenda-appointment-card";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { getTzParts, slotIndexToUtc } from "@/lib/agenda/time-utils";
import { calendarDayISO } from "@/lib/agenda/date-ranges";
import { assignLanes } from "@/lib/agenda/lane-layout";
import type { DroppableData } from "@/lib/agenda/drag-utils";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import {
  useDragOverlap,
  type AgendaColumnDescriptor,
} from "@/app/dashboard/agenda/agenda-page-client";
import styles from "./agenda.module.css";

export function AgendaColumn({ column }: { column: AgendaColumnDescriptor }) {
  const { state } = useAgenda();
  const { open: openNewAppointment } = useNewAppointmentDialog();
  const ref = useRef<HTMLDivElement | null>(null);

  const droppableData: DroppableData =
    column.type === "doctor"
      ? {
          kind: "doctor-col",
          columnKey: column.key,
          doctorId: column.doctorId!,
          resourceId: null,
        }
      : column.type === "resource"
      ? {
          kind: "resource-col",
          columnKey: column.key,
          doctorId: null,
          resourceId: column.resourceId!,
        }
      : {
          kind: "unified-col",
          columnKey: column.key,
          doctorId: null,
          resourceId: null,
        };

  const droppableId = `col:${column.key}`;
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: droppableId,
    data: droppableData,
  });
  const overlapMode = useDragOverlap(droppableId);

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      setDropRef(el);
    },
    [setDropRef],
  );

  const appointmentsHere = useMemo(() => {
    // En la vista Día solo mostramos las citas cuyo día calendario en
    // tz coincide con state.dayISO. El rango fetch ya está acotado, pero
    // aplicamos el filtro defensivamente para que cualquier residuo
    // entre transiciones (ej. cache stale al cambiar de día) no
    // contamine la columna.
    const sameDay = state.appointments.filter(
      (a) => calendarDayISO(a.startsAt, state.timezone) === state.dayISO,
    );
    if (column.type === "unified") return sameDay;
    if (column.type === "doctor") {
      return sameDay.filter((a) => a.doctor?.id === column.doctorId);
    }
    return sameDay.filter((a) => a.resourceId === column.resourceId);
  }, [state.appointments, state.dayISO, state.timezone, column]);

  // Bug C: dentro de cada columna (doctor o sillón) puede haber citas
  // overlapping. Asignamos lanes para que se rendericen una al lado de
  // la otra dentro del ancho de la columna.
  const lanedAppointments = useMemo(
    () => assignLanes(appointmentsHere, state.slotMinutes),
    [appointmentsHere, state.slotMinutes],
  );

  // Slots base = horario de trabajo configurado. Si hay citas fuera de
  // horario (ej. emergencia a las 23:55), extendemos el alto para que
  // queden visibles en lugar de quedar clipped fuera del DOM.
  const baseSlotsTotal =
    ((state.dayEnd - state.dayStart) * 60) / state.slotMinutes;
  const slotsTotal = useMemo(() => {
    let maxSlot = baseSlotsTotal;
    for (const a of appointmentsHere) {
      const endIso = a.endsAt ?? a.startsAt;
      const endParts = getTzParts(new Date(endIso), state.timezone);
      // Solo consideramos cita que termina en el mismo día calendario;
      // si cruza medianoche (raro), tomamos el final del día visible.
      const endsToday =
        calendarDayISO(endIso, state.timezone) === state.dayISO;
      const endSlot = endsToday
        ? ((endParts.hour - state.dayStart) * 60 + endParts.minute) /
          state.slotMinutes
        : (24 - state.dayStart) * 60 / state.slotMinutes;
      if (endSlot > maxSlot) maxSlot = Math.ceil(endSlot);
    }
    return maxSlot;
  }, [appointmentsHere, baseSlotsTotal, state.dayISO, state.dayStart, state.slotMinutes, state.timezone]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(`.${styles.appt}`)) return;

      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const slotHeight = rect.height / slotsTotal;
      const y = e.clientY - rect.top;
      const slotIdx = Math.max(0, Math.min(slotsTotal - 1, Math.floor(y / slotHeight)));

      const startsAt = slotIndexToUtc(slotIdx, state.dayISO, {
        timezone: state.timezone,
        slotMinutes: state.slotMinutes,
        dayStart: state.dayStart,
        dayEnd: state.dayEnd,
      });

      openNewAppointment({
        initialSlot: {
          startsAt: startsAt.toISOString(),
          doctorId: column.doctorId ?? undefined,
          resourceId: column.resourceId,
        },
        openAgendaAfter: true,
      });
    },
    [openNewAppointment, slotsTotal, state.dayISO, state.dayEnd, state.dayStart, state.slotMinutes, state.timezone, column.doctorId, column.resourceId],
  );

  const hourBands = [];
  for (let h = 1; h < state.dayEnd - state.dayStart; h++) {
    hourBands.push(
      <div
        key={h}
        className={styles.columnHourBand}
        style={{ top: `calc(${h} * 60 / ${state.slotMinutes} * var(--mf-agenda-slot-h))` }}
      />,
    );
  }

  const dropClass = isOver
    ? overlapMode === "conflict"
      ? styles.dropOverConflict
      : overlapMode === "ok"
      ? styles.dropOverOk
      : styles.dropOver
    : "";

  return (
    <div
      ref={setRefs}
      className={`${styles.column} ${dropClass}`}
      onClick={handleClick}
      role="grid"
      aria-label={`Columna ${column.title}`}
      style={{
        height: `calc(${slotsTotal} * var(--mf-agenda-slot-h))`,
      }}
    >
      {hourBands}
      {lanedAppointments.map(({ appt, lane, laneCount }) => (
        <AgendaAppointmentCard
          key={appt.id}
          appointment={appt}
          dayISO={state.dayISO}
          slotMinutes={state.slotMinutes}
          dayStart={state.dayStart}
          timezone={state.timezone}
          lane={lane}
          laneCount={laneCount}
          columnMode={column.type}
          resourceColor={column.color}
        />
      ))}
    </div>
  );
}

export type { AgendaAppointmentDTO };
