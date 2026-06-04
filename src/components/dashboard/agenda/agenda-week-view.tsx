"use client";

import { useCallback, useMemo, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useAgenda } from "./agenda-provider";
import { useT } from "@/i18n/i18n-provider";
import { AgendaTimeAxis } from "./agenda-time-axis";
import { AgendaAppointmentCard } from "./agenda-appointment-card";
import { slotIndexToUtc, todayInTz } from "@/lib/agenda/time-utils";
import { calendarDayISO } from "@/lib/agenda/date-ranges";
import { assignLanes } from "@/lib/agenda/lane-layout";
import { useDragOverlap } from "@/app/dashboard/agenda/agenda-page-client";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import type { DroppableData } from "@/lib/agenda/drag-utils";
import styles from "./agenda.module.css";

const WEEKDAY_KEYS = [
  "agenda.weekView.dowMon",
  "agenda.weekView.dowTue",
  "agenda.weekView.dowWed",
  "agenda.weekView.dowThu",
  "agenda.weekView.dowFri",
  "agenda.weekView.dowSat",
  "agenda.weekView.dowSun",
];

interface WeekDay {
  iso: string;
  day: number;
  dowKey: string;
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
      dowKey: WEEKDAY_KEYS[i]!,
    });
  }
  return out;
}

export function AgendaWeekView() {
  const { state, setDay, setViewMode } = useAgenda();
  const t = useT();

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
                aria-label={t("agenda.weekView.openDayAria", { date: d.iso })}
                title={t("agenda.weekView.openDayTitle", { date: d.iso })}
              >
                <div className={styles.weekHeaderDow}>{t(d.dowKey)}</div>
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
  const t = useT();
  const { open: openNewAppointment } = useNewAppointmentDialog();
  const colRef = useRef<HTMLDivElement | null>(null);

  // Filtramos las citas del rango (cargadas por el provider) que caen
  // exactamente en este día, en el timezone de la clínica.
  const dayAppts = useMemo<AgendaAppointmentDTO[]>(
    () => state.appointments.filter((a) => calendarDayISO(a.startsAt, state.timezone) === day.iso),
    [state.appointments, day.iso, state.timezone],
  );

  // Bug C: cada día puede tener citas que se solapan en horario.
  // Asignamos lanes (columnas paralelas) para que se rendericen una al
  // lado de la otra en vez de apiladas en la misma posición.
  const lanedAppts = useMemo(
    () => assignLanes(dayAppts, state.slotMinutes),
    [dayAppts, state.slotMinutes],
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

  // Ref de medición compuesta con el setNodeRef del droppable (dnd-kit):
  // necesitamos el rect del DOM para derivar el slot desde el click-Y,
  // igual que agenda-column.tsx en vista Día.
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      colRef.current = el;
      setNodeRef(el);
    },
    [setNodeRef],
  );

  // Click en un slot vacío → abrir "Nueva cita" con el inicio EXACTO del
  // slot pre-llenado. Vista Semana es columna unificada por día (sin split
  // por doctor), así que initialSlot solo lleva startsAt (sin doctorId).
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(`.${styles.appt}`)) return;
      setDay(day.iso);
      const el = colRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const slotHeight = rect.height / slotsTotal;
      const y = e.clientY - rect.top;
      const slotIdx = Math.max(0, Math.min(slotsTotal - 1, Math.floor(y / slotHeight)));
      const startsAt = slotIndexToUtc(slotIdx, day.iso, {
        timezone: state.timezone,
        slotMinutes: state.slotMinutes,
        dayStart: state.dayStart,
        dayEnd: state.dayEnd,
      });
      openNewAppointment({
        initialSlot: { startsAt: startsAt.toISOString(), resourceId: null },
        openAgendaAfter: true,
      });
    },
    [openNewAppointment, setDay, day.iso, slotsTotal, state.timezone, state.slotMinutes, state.dayStart, state.dayEnd],
  );

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
      ref={setRefs}
      className={classes}
      style={{
        height: `calc(${slotsTotal} * var(--mf-agenda-slot-h))`,
      }}
      onClick={handleClick}
      role="grid"
      aria-label={t("agenda.weekView.dayColAria", { date: day.iso })}
    >
      {lanedAppts.map(({ appt, lane, laneCount }) => (
        <AgendaAppointmentCard
          key={appt.id}
          appointment={appt}
          dayISO={day.iso}
          slotMinutes={state.slotMinutes}
          dayStart={state.dayStart}
          timezone={state.timezone}
          lane={lane}
          laneCount={laneCount}
          columnMode="unified"
        />
      ))}
    </div>
  );
}
