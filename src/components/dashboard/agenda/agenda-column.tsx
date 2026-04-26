"use client";

import { useCallback, useMemo, useRef } from "react";
import { useAgenda } from "./agenda-provider";
import { AgendaAppointmentCard } from "./agenda-appointment-card";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { slotIndexToUtc } from "@/lib/agenda/time-utils";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import type { AgendaColumnDescriptor } from "@/app/dashboard/agenda/agenda-page-client";
import styles from "./agenda.module.css";

export function AgendaColumn({ column }: { column: AgendaColumnDescriptor }) {
  const { state } = useAgenda();
  const { open: openNewAppointment } = useNewAppointmentDialog();
  const ref = useRef<HTMLDivElement>(null);

  const appointmentsHere = useMemo(() => {
    if (column.type === "unified") return state.appointments;
    if (column.type === "doctor") {
      return state.appointments.filter((a) => a.doctor?.id === column.doctorId);
    }
    return state.appointments.filter((a) => a.resourceId === column.resourceId);
  }, [state.appointments, column]);

  const slotsTotal =
    ((state.dayEnd - state.dayStart) * 60) / state.slotMinutes;

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

  return (
    <div
      ref={ref}
      className={styles.column}
      onClick={handleClick}
      role="grid"
      aria-label={`Columna ${column.title}`}
      style={{
        height: `calc(${slotsTotal} * var(--mf-agenda-slot-h))`,
      }}
    >
      {hourBands}
      {appointmentsHere.map((appt) => (
        <AgendaAppointmentCard
          key={appt.id}
          appointment={appt}
          dayISO={state.dayISO}
          slotMinutes={state.slotMinutes}
          dayStart={state.dayStart}
          timezone={state.timezone}
        />
      ))}
    </div>
  );
}

export type { AgendaAppointmentDTO };
