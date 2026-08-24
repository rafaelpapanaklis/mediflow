"use client";

// ═══════════════════════════════════════════════════════════════════════
// Vista SEMANA — para ver de un vistazo dónde queda hueco. Una columna por
// día, con TODOS los barberos mezclados (el punto de color dice quién es;
// el fondo y la barra, en qué estado va).
//
// Aquí NO se arrastra a propósito: mover una visita entre días exige elegir
// barbero, y esa decisión se toma mejor en la vista día o en el detalle.
// Tocar el encabezado de un día lleva a la vista día de ese día; tocar una
// visita abre su detalle, igual que en la vista día.
//
// Los bloques también son proporcionales (1.1 px por minuto): media semana
// llena se lee sin abrir nada.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import {
  BARBER_APPOINTMENT_STATUS_UI,
  isTerminalAppointmentStatus,
  type BarberAppointmentDTO,
  type BarberDTO,
  type BarberScheduleDTO,
} from "@/lib/barber/types";
import {
  BARBER_CARD_COMPACT_PX,
  BARBER_CARD_MIN_PX,
  BARBER_WEEK_PX_PER_MIN,
  assignLanes,
  barberDayWindows,
  computeGridBounds,
  minuteToHourLabel,
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

  const now = Date.now();

  return (
    <div className={css.board}>
      <div className={css.scroller}>
        <div className={css.grid} style={{ gridTemplateColumns: "58px repeat(7, minmax(0, 1fr))" }}>
          <div className={css.headCorner} />
          {perDay.map(({ day, items }) => {
            const isToday = day === todayISO;
            const count = items.filter((i) => i.appointment.status !== "CANCELLED").length;
            return (
              <div key={`h-${day}`} className={`${css.headCell} ${isToday ? css.weekToday : ""}`}>
                <button
                  type="button"
                  className={css.weekHead}
                  onClick={() => props.onPickDay(day)}
                  aria-label={t("barber.agenda.views.goToDay")}
                >
                  <span className={css.weekHeadDay}>
                    {t(`barber.agenda.weekdaysShort.${weekdayOfISO(day)}`)}
                  </span>
                  <span className={css.weekHeadDate}>{parseInt(day.slice(8), 10)}</span>
                  <span className={css.weekHeadCount}>
                    {count > 0 ? t("barber.agenda.summary.appointments", { count }) : "—"}
                  </span>
                </button>
              </div>
            );
          })}

          <div className={css.gutter} style={{ height, position: "relative" }}>
            {hourMarks.map((m) => (
              <span key={m} className={css.gutterMark} style={{ top: Math.max(7, yOf(m)) }}>
                {minuteToHourLabel(m)}
              </span>
            ))}
          </div>

          {perDay.map(({ day, items }) => {
            const lanes = assignLanes(items.map((i) => ({ start: i.start, end: i.end })));
            const isToday = day === todayISO;
            return (
              <div
                key={day}
                className={`${css.column} ${isToday ? css.weekTodayCol : ""}`}
                style={{ height }}
              >
                {hourMarks
                  .filter((m) => m < bounds.end)
                  .map((m) => (
                    <div
                      key={`hb-${m}`}
                      className={css.halfBand}
                      style={{ top: yOf(m + 30), height: 30 * PX }}
                    />
                  ))}
                {hourMarks.map((m) => (
                  <div key={`l-${m}`} className={css.hourLine} style={{ top: yOf(m) }} />
                ))}

                {items.map((item, index) => {
                  const appt = item.appointment;
                  const lane = lanes[index];
                  const widthPct = 100 / lane.lanes;
                  const ui = BARBER_APPOINTMENT_STATUS_UI[appt.status];
                  const blockHeight = Math.max(
                    BARBER_CARD_MIN_PX,
                    (Math.min(bounds.end, item.end) - Math.max(bounds.start, item.start)) * PX,
                  );
                  const startLabel = minuteToLabel(item.start);
                  const clientLabel = appt.clientName || t("barber.agenda.card.noClient");
                  const terminal = isTerminalAppointmentStatus(appt.status);
                  const startMs = new Date(appt.startAt).getTime();
                  const endMs = new Date(appt.endAt).getTime();
                  const live = !terminal && startMs <= now && now < endMs;
                  const past = !terminal && !live && endMs <= now;
                  return (
                    <button
                      type="button"
                      key={appt.id}
                      data-status={appt.status}
                      className={[
                        css.card,
                        blockHeight < BARBER_CARD_COMPACT_PX ? css.cardCompact : "",
                        live ? css.cardLive : "",
                        past ? css.cardPast : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{
                        top: yOf(Math.max(bounds.start, item.start)),
                        height: blockHeight,
                        left: `calc(${lane.lane * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                      }}
                      aria-label={t("barber.agenda.card.aria", {
                        time: startLabel,
                        client: clientLabel,
                        status: ui.label,
                      })}
                      title={`${startLabel} – ${minuteToLabel(item.end)} · ${clientLabel} · ${
                        appt.barberName ?? ""
                      } · ${ui.label}`}
                      onClick={() => props.onCardClick(appt)}
                    >
                      <span className={css.cardRow}>
                        <span className={css.cardTime}>{startLabel}</span>
                        <span className={css.cardDot} aria-hidden />
                      </span>
                      <span className={css.cardName}>{clientLabel}</span>
                      {/* La tercera línea solo si CABE entera: media semana
                          llena de nombres cortados a la mitad se lee peor
                          que media semana sin el nombre del barbero. */}
                      {blockHeight >= 60 ? (
                        <span className={css.cardServices}>
                          <span
                            className={css.cardBarberDot}
                            style={{
                              background: barberColor(appt.barberId ?? "sin"),
                              display: "inline-block",
                              marginRight: 5,
                              verticalAlign: -1,
                            }}
                            aria-hidden
                          />
                          {appt.barberName ?? t("barber.agenda.card.noBarber")}
                        </span>
                      ) : null}
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
