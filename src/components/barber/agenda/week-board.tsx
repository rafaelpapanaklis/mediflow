"use client";

// ═══════════════════════════════════════════════════════════════════════
// Vista SEMANA — para ver de un vistazo dónde queda hueco. Una columna por
// día, con TODOS los barberos mezclados (el color del borde dice quién es).
//
// Aquí NO se arrastra a propósito: mover una visita entre días exige elegir
// barbero, y esa decisión se toma mejor en la vista día o en el modal de
// edición. Tocar un día lleva a la vista día de ese día.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import {
  BARBER_APPOINTMENT_STATUS_UI,
  type BarberAppointmentDTO,
  type BarberDTO,
  type BarberScheduleDTO,
} from "@/lib/barber/types";
import {
  BARBER_WEEK_PX_PER_MIN,
  assignLanes,
  barberDayWindows,
  computeGridBounds,
  minuteToLabel,
  shopDateISO,
  shopLocalToUtc,
  weekDaysISO,
  weekdayOfISO,
  type MinuteWindow,
} from "@/lib/barber/agenda";
import { agendaCss as css, barberColor } from "./agenda-ui";

const PX = BARBER_WEEK_PX_PER_MIN;

export interface WeekBoardProps {
  dateISO: string;
  timezone: string;
  barbers: BarberDTO[];
  appointments: BarberAppointmentDTO[];
  schedules: BarberScheduleDTO[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  onPickDay: (dateISO: string) => void;
  onCardClick: (appointment: BarberAppointmentDTO) => void;
}

export function WeekBoard(props: WeekBoardProps) {
  const { dateISO, timezone, barbers, appointments, schedules, t } = props;
  const days = useMemo(() => weekDaysISO(dateISO), [dateISO]);
  const todayISO = useMemo(() => shopDateISO(new Date(), timezone), [timezone]);

  const active = useMemo(() => barbers.filter((b) => b.isActive), [barbers]);

  const perDay = useMemo(() => {
    return days.map((day) => {
      const dayStartUtc = shopLocalToUtc(day, 0, timezone).getTime();
      const dayEndUtc = dayStartUtc + 24 * 3_600_000;
      const items = appointments
        .filter((a) => {
          const s = new Date(a.startAt).getTime();
          return s >= dayStartUtc && s < dayEndUtc;
        })
        .map((a) => ({
          appointment: a,
          start: (new Date(a.startAt).getTime() - dayStartUtc) / 60_000,
          end: (new Date(a.endAt).getTime() - dayStartUtc) / 60_000,
        }))
        .sort((a, b) => a.start - b.start);
      const weekday = weekdayOfISO(day);
      const windows: MinuteWindow[] = [];
      for (const b of active) windows.push(...barberDayWindows(schedules, b.id, weekday));
      return { day, dayStartUtc, items, windows };
    });
  }, [days, timezone, appointments, active, schedules]);

  const bounds = useMemo(() => {
    const windows: MinuteWindow[] = [];
    const appts: MinuteWindow[] = [];
    for (const d of perDay) {
      windows.push(...d.windows);
      for (const item of d.items) appts.push({ start: item.start, end: item.end });
    }
    return computeGridBounds(windows, appts);
  }, [perDay]);

  const height = Math.max(240, (bounds.end - bounds.start) * PX);
  const yOf = (minute: number) => (minute - bounds.start) * PX;

  const hourMarks: number[] = [];
  for (let m = bounds.start; m <= bounds.end; m += 60) hourMarks.push(m);

  return (
    <div className={css.board}>
      <div className={css.scroller}>
        <div className={css.grid} style={{ gridTemplateColumns: "62px repeat(7, minmax(112px, 1fr))" }}>
          <div className={css.headCorner} />
          {perDay.map(({ day }) => {
            const isToday = day === todayISO;
            return (
              <div key={`h-${day}`} className={`${css.headCell} ${isToday ? css.weekToday : ""}`}>
                <button
                  type="button"
                  className={css.weekHead}
                  onClick={() => props.onPickDay(day)}
                  style={{ background: "transparent", border: 0, padding: 0, textAlign: "left" }}
                >
                  <span className={css.weekHeadDay}>
                    {t(`barber.agenda.weekdaysShort.${weekdayOfISO(day)}`)}
                  </span>
                  <span className={css.weekHeadDate}>{parseInt(day.slice(8), 10)}</span>
                </button>
              </div>
            );
          })}

          <div className={css.gutter} style={{ height, position: "relative" }}>
            {hourMarks.map((m) => (
              <span key={m} className={css.gutterMark} style={{ top: yOf(m) }}>
                {minuteToLabel(m)}
              </span>
            ))}
          </div>

          {perDay.map(({ day, items }) => {
            const lanes = assignLanes(items.map((i) => ({ start: i.start, end: i.end })));
            return (
              <div key={day} className={css.column} style={{ height }}>
                {hourMarks.map((m) => (
                  <div key={`l-${m}`} className={css.hourLine} style={{ top: yOf(m) }} />
                ))}
                {items.map((item, index) => {
                  const lane = lanes[index];
                  const widthPct = 100 / lane.lanes;
                  const ui = BARBER_APPOINTMENT_STATUS_UI[item.appointment.status];
                  const dim =
                    item.appointment.status === "CANCELLED" || item.appointment.status === "NO_SHOW";
                  return (
                    <button
                      type="button"
                      key={item.appointment.id}
                      className={`${css.card} ${css.cardCompact}`}
                      style={{
                        top: yOf(Math.max(bounds.start, item.start)),
                        height: Math.max(18, (item.end - item.start) * PX),
                        left: `calc(${lane.lane * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        borderLeftColor: barberColor(item.appointment.barberId ?? "sin"),
                        opacity: dim ? 0.5 : 1,
                      }}
                      title={`${minuteToLabel(item.start)} · ${item.appointment.clientName ?? ""} · ${
                        item.appointment.barberName ?? ""
                      } · ${ui.label}`}
                      onClick={() => props.onCardClick(item.appointment)}
                    >
                      <span className={css.cardTime}>{minuteToLabel(item.start)}</span>
                      <span className={css.cardName}>
                        {item.appointment.clientName || t("barber.agenda.card.noClient")}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
