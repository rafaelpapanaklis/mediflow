"use client";

import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useAgenda } from "./agenda-provider";
import { AgendaTimeAxis } from "./agenda-time-axis";
import { AgendaAppointmentCard } from "./agenda-appointment-card";
import { getTzParts, todayInTz } from "@/lib/agenda/time-utils";
import { useDragOverlap } from "@/app/dashboard/agenda/agenda-page-client";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import type { DroppableData } from "@/lib/agenda/drag-utils";
import styles from "./agenda.module.css";

function dateKeyInTz(iso: string, timezone: string): string {
  const p = getTzParts(new Date(iso), timezone);
  return `${p.year}-${p.month.toString().padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
}

const WEEKDAYS_ES = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

interface WeekDay {
  iso: string;
  day: number;
  dow: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function buildWeekDays(refISO: string): WeekDay[] {
  const [y, m, d] = refISO.split("-").map((n) => parseInt(n, 10));
  const ref = new Date(Date.UTC(y, m - 1, d));
  const dow = (ref.getUTCDay() + 6) % 7; // Mon=0
  const monday = new Date(Date.UTC(y, m - 1, d - dow));
  const out: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday.getTime() + i * 86_400_000);
    out.push({
      iso: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
      day: dt.getUTCDate(),
      dow: WEEKDAYS_ES[i]!,
    });
  }
  return out;
}

export function AgendaWeekView() {
  const { state, setDay, setViewMode } = useAgenda();

  const days = useMemo(() => buildWeekDays(state.dayISO), [state.dayISO]);
  const today = todayInTz(state.timezone);

  const slotsTotal = ((state.dayEnd - state.dayStart) * 60) / state.slotMinutes;

  function jumpToDay(iso: string) {
    setDay(iso);
    setViewMode("day");
  }

  return (
    <div className={styles.scrollArea}>
      <div
        className={styles.scrollGrid}
        style={
          {
            "--mf-agenda-cols": days.length,
            "--mf-agenda-slot-min": state.slotMinutes,
            "--mf-agenda-day-start": state.dayStart,
            "--mf-agenda-day-end": state.dayEnd,
          } as React.CSSProperties
        }
      >
        <div className={styles.cornerCell} aria-hidden />
        <div className={styles.columnsHeader}>
          {days.map((d) => {
            const classes = [
              styles.weekHeaderCell,
              d.iso === today ? styles.today : "",
              d.iso === state.dayISO ? styles.active : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={d.iso}
                type="button"
                className={classes}
                onClick={() => jumpToDay(d.iso)}
                aria-label={`Abrir vista día ${d.iso}`}
                title={`Ver el día ${d.iso} en vista detallada`}
              >
                <div className={styles.weekHeaderDow}>{d.dow}</div>
                <div className={styles.weekHeaderDay}>{d.day}</div>
              </button>
            );
          })}
        </div>
        <AgendaTimeAxis />
        <div className={styles.columnsBody}>
          {days.map((d) => (
            <WeekDayColumn
              key={d.iso}
              day={d}
              isToday={d.iso === today}
              slotsTotal={slotsTotal}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface WeekDayColumnProps {
  day: WeekDay;
  isToday: boolean;
  slotsTotal: number;
}

function WeekDayColumn({ day, isToday, slotsTotal }: WeekDayColumnProps) {
  const { state, setDay } = useAgenda();

  // Filtramos las citas del rango (cargadas por el provider) que caen
  // exactamente en este día, en el timezone de la clínica.
  const dayAppts = useMemo<AgendaAppointmentDTO[]>(
    () => state.appointments.filter((a) => dateKeyInTz(a.startsAt, state.timezone) === day.iso),
    [state.appointments, day.iso, state.timezone],
  );

  const droppableData: DroppableData = {
    kind: "day-col",
    dayISO: day.iso,
  };

  const droppableId = `day:${day.iso}`;
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: droppableData,
  });
  const overlapMode = useDragOverlap(droppableId);

  const dropClass = isOver
    ? overlapMode === "conflict"
      ? styles.dropOverConflict
      : overlapMode === "ok"
      ? styles.dropOverOk
      : styles.dropOver
    : "";

  const classes = [
    styles.weekDayCol,
    isToday ? styles.today : "",
    dropClass,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={setNodeRef}
      className={classes}
      style={{
        height: `calc(${slotsTotal} * var(--mf-agenda-slot-h))`,
      }}
      onClick={() => setDay(day.iso)}
      role="grid"
      aria-label={`Día ${day.iso}`}
    >
      {dayAppts.map((appt) => (
        <AgendaAppointmentCard
          key={appt.id}
          appointment={appt}
          dayISO={day.iso}
          slotMinutes={state.slotMinutes}
          dayStart={state.dayStart}
          timezone={state.timezone}
        />
      ))}
    </div>
  );
}
