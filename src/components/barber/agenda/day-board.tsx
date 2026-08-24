"use client";

// ═══════════════════════════════════════════════════════════════════════
// Vista DÍA — la pantalla que la barbería tiene abierta todo el día.
// Una columna por silla, arrastrar para mover, tocar un hueco para agendar.
//
// El arrastre es con eventos de puntero a pelo (no @dnd-kit) por dos
// razones: la rejilla tendría cientos de zonas soltables (15 min × N
// barberos) y, sobre todo, hay que VALIDAR el hueco mientras el dedo se
// mueve para pintar el fantasma en rojo ANTES de soltar. La validación es
// la misma función que corre el servidor: checkAppointmentSlot().
//
// Alternativa accesible al arrastre: la tarjeta es un <button>; con Enter
// se abre el detalle y desde ahí "Editar" cambia hora y barbero sin ratón.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BARBER_APPOINTMENT_STATUS_UI,
  BARBER_TIME_OFF_TYPE_LABELS,
  isTerminalAppointmentStatus,
  type BarberAppointmentDTO,
  type BarberDTO,
  type BarberScheduleDTO,
  type BarberTimeOffDTO,
} from "@/lib/barber/types";
import {
  BARBER_DAY_PX_PER_MIN,
  BARBER_SLOT_MINUTES,
  barberDayWindows,
  checkAppointmentSlot,
  computeGridBounds,
  hasAnySchedule,
  minuteToLabel,
  shopDateISO,
  shopLocalToUtc,
  snapMinute,
  weekdayOfISO,
  type MinuteWindow,
} from "@/lib/barber/agenda";
import { agendaCss as css, barberColor, initials } from "./agenda-ui";

export interface DayBoardProps {
  dateISO: string;
  timezone: string;
  barbers: BarberDTO[];
  appointments: BarberAppointmentDTO[];
  schedules: BarberScheduleDTO[];
  timeOff: BarberTimeOffDTO[];
  canEdit: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onSlotClick: (barberId: string, startAt: Date) => void;
  onCardClick: (appointment: BarberAppointmentDTO) => void;
  onMove: (appointment: BarberAppointmentDTO, startAt: Date, barberId: string) => void;
}

interface DragState {
  appointmentId: string;
  pointerId: number;
  originX: number;
  originY: number;
  durationMin: number;
  active: boolean;
  startMin: number;
  barberId: string;
  ok: boolean;
}

const PX = BARBER_DAY_PX_PER_MIN;

export function DayBoard(props: DayBoardProps) {
  const { dateISO, timezone, barbers, appointments, schedules, timeOff, canEdit, t } = props;

  const columns = useMemo(() => barbers.filter((b) => b.isActive), [barbers]);
  const dayStartUtc = useMemo(
    () => shopLocalToUtc(dateISO, 0, timezone).getTime(),
    [dateISO, timezone],
  );
  const weekday = useMemo(() => weekdayOfISO(dateISO), [dateISO]);

  /** Minutos desde la medianoche local del día que se está viendo. */
  const toMinutes = useCallback(
    (iso: string) => (new Date(iso).getTime() - dayStartUtc) / 60_000,
    [dayStartUtc],
  );

  const windowsByBarber = useMemo(() => {
    const map = new Map<string, MinuteWindow[]>();
    for (const b of columns) map.set(b.id, barberDayWindows(schedules, b.id, weekday));
    return map;
  }, [columns, schedules, weekday]);

  const bounds = useMemo(() => {
    const allWindows: MinuteWindow[] = [];
    for (const list of Array.from(windowsByBarber.values())) allWindows.push(...list);
    const apptWindows = appointments.map((a) => ({
      start: toMinutes(a.startAt),
      end: toMinutes(a.endAt),
    }));
    return computeGridBounds(allWindows, apptWindows);
  }, [windowsByBarber, appointments, toMinutes]);

  const height = Math.max(240, (bounds.end - bounds.start) * PX);
  const yOf = useCallback((minute: number) => (minute - bounds.start) * PX, [bounds.start]);

  // ── Línea del "ahora" ────────────────────────────────────────────────
  const [nowMinute, setNowMinute] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const isToday = shopDateISO(new Date(), timezone) === dateISO;
      setNowMinute(isToday ? (Date.now() - dayStartUtc) / 60_000 : null);
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [dateISO, timezone, dayStartUtc]);

  // ── Arrastre ─────────────────────────────────────────────────────────
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const validate = useCallback(
    (appointmentId: string, barberId: string, startMin: number, durationMin: number) => {
      const startAt = new Date(dayStartUtc + startMin * 60_000);
      const endAt = new Date(startAt.getTime() + durationMin * 60_000);
      return checkAppointmentSlot({
        startAt,
        endAt,
        barberId,
        timezone,
        schedules,
        timeOff,
        appointments,
        excludeAppointmentId: appointmentId,
      }).ok;
    },
    [dayStartUtc, timezone, schedules, timeOff, appointments],
  );

  const columnAt = useCallback(
    (clientX: number): string | null => {
      let best: string | null = null;
      for (const [id, node] of Array.from(columnRefs.current.entries())) {
        const rect = node.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right) return id;
        if (best === null) best = id;
      }
      return best;
    },
    [],
  );

  const onPointerDown = (e: React.PointerEvent, appt: BarberAppointmentDTO) => {
    if (!canEdit || !appt.barberId || isTerminalAppointmentStatus(appt.status)) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const durationMin = (new Date(appt.endAt).getTime() - new Date(appt.startAt).getTime()) / 60_000;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      appointmentId: appt.id,
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      durationMin,
      active: false,
      startMin: toMinutes(appt.startAt),
      barberId: appt.barberId,
      ok: true,
    });
  };

  const onPointerMove = (e: React.PointerEvent, appt: BarberAppointmentDTO) => {
    const current = dragRef.current;
    if (!current || current.appointmentId !== appt.id) return;
    const dx = e.clientX - current.originX;
    const dy = e.clientY - current.originY;
    const active = current.active || Math.abs(dx) > 4 || Math.abs(dy) > 4;
    if (!active) return;

    const baseMin = toMinutes(appt.startAt);
    const startMin = Math.max(0, snapMinute(baseMin + dy / PX, BARBER_SLOT_MINUTES));
    const barberId = columnAt(e.clientX) ?? appt.barberId ?? current.barberId;
    const ok = validate(appt.id, barberId, startMin, current.durationMin);
    setDrag({ ...current, active: true, startMin, barberId, ok });
  };

  const onPointerUp = (e: React.PointerEvent, appt: BarberAppointmentDTO) => {
    const current = dragRef.current;
    setDrag(null);
    if (!current || current.appointmentId !== appt.id) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(current.pointerId);
    } catch {
      /* el navegador ya lo soltó */
    }
    if (!current.active) {
      props.onCardClick(appt);
      return;
    }
    const movedTime = Math.abs(current.startMin - toMinutes(appt.startAt)) >= 1;
    const movedBarber = current.barberId !== appt.barberId;
    if (!movedTime && !movedBarber) return;
    if (!current.ok) return;
    props.onMove(appt, new Date(dayStartUtc + current.startMin * 60_000), current.barberId);
  };

  // ── Huecos: tocar la columna para agendar ────────────────────────────
  const onColumnClick = (e: React.MouseEvent, barberId: string) => {
    if (!canEdit || drag) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const minute = snapMinute(bounds.start + (e.clientY - rect.top) / PX, BARBER_SLOT_MINUTES);
    props.onSlotClick(barberId, new Date(dayStartUtc + minute * 60_000));
  };

  if (columns.length === 0) {
    return (
      <div className={css.board}>
        <div className={css.empty}>
          <p className={css.emptyTitle}>{t("barber.agenda.state.noBarbersTitle")}</p>
          <p>{t("barber.agenda.state.noBarbersBody")}</p>
        </div>
      </div>
    );
  }

  const hourMarks: number[] = [];
  for (let m = bounds.start; m <= bounds.end; m += 60) hourMarks.push(m);

  return (
    <div className={css.board}>
      <div className={css.scroller}>
        <div
          className={css.grid}
          style={{ gridTemplateColumns: `62px repeat(${columns.length}, minmax(168px, 1fr))` }}
        >
          {/* Encabezado */}
          <div className={css.headCorner} />
          {columns.map((barber) => {
            const windows = windowsByBarber.get(barber.id) ?? [];
            const configured = hasAnySchedule(schedules, barber.id);
            return (
              <div key={`h-${barber.id}`} className={css.headCell}>
                <div className={css.headName}>
                  <span
                    className={css.headAvatar}
                    style={{ borderColor: barberColor(barber.id), color: barberColor(barber.id) }}
                  >
                    {initials(barber.nickname || barber.name)}
                  </span>
                  <span className={css.headLabel}>{barber.nickname || barber.name}</span>
                </div>
                <div className={css.headMeta}>
                  {!configured
                    ? t("barber.agenda.state.noSchedule")
                    : windows.length === 0
                      ? t("barber.agenda.schedule.closedDay")
                      : windows
                          .map((w) => `${minuteToLabel(w.start)} – ${minuteToLabel(w.end)}`)
                          .join(" · ")}
                </div>
              </div>
            );
          })}

          {/* Regleta de horas */}
          <div className={css.gutter} style={{ height, position: "relative" }}>
            {hourMarks.map((m) => (
              <span key={m} className={css.gutterMark} style={{ top: yOf(m) }}>
                {minuteToLabel(m)}
              </span>
            ))}
          </div>

          {/* Columnas */}
          {columns.map((barber) => {
            const windows = windowsByBarber.get(barber.id) ?? [];
            const configured = hasAnySchedule(schedules, barber.id);
            const closed = configured ? complement(windows, bounds) : [];
            const blocks = timeOff.filter((off) => off.barberId === null || off.barberId === barber.id);
            const cards = appointments.filter((a) => a.barberId === barber.id);
            const ghost = drag?.active && drag.barberId === barber.id ? drag : null;

            return (
              <div
                key={barber.id}
                ref={(node) => {
                  if (node) columnRefs.current.set(barber.id, node);
                  else columnRefs.current.delete(barber.id);
                }}
                className={`${css.column} ${canEdit ? css.columnClickable : ""}`}
                style={{ height }}
                onClick={(e) => onColumnClick(e, barber.id)}
              >
                {hourMarks.map((m) => (
                  <div key={`l-${m}`} className={css.hourLine} style={{ top: yOf(m) }} />
                ))}
                {hourMarks.map((m) => (
                  <div key={`hl-${m}`} className={css.halfLine} style={{ top: yOf(m + 30) }} />
                ))}

                {closed.map((band, i) => (
                  <div
                    key={`c-${i}`}
                    className={css.closedBand}
                    style={{ top: yOf(band.start), height: Math.max(0, (band.end - band.start) * PX) }}
                  />
                ))}

                {blocks.map((off) => {
                  const start = Math.max(bounds.start, toMinutes(off.startAt));
                  const end = Math.min(bounds.end, toMinutes(off.endAt));
                  if (end <= start) return null;
                  return (
                    <div
                      key={`t-${off.id}`}
                      className={css.timeOffBand}
                      style={{ top: yOf(start), height: Math.max(14, (end - start) * PX) }}
                    >
                      {off.reason || BARBER_TIME_OFF_TYPE_LABELS[off.type]}
                    </div>
                  );
                })}

                {cards.map((appt) => {
                  const start = toMinutes(appt.startAt);
                  const end = toMinutes(appt.endAt);
                  const top = yOf(Math.max(bounds.start, start));
                  const cardHeight = Math.max(20, (Math.min(bounds.end, end) - Math.max(bounds.start, start)) * PX);
                  const ui = BARBER_APPOINTMENT_STATUS_UI[appt.status];
                  const dim = appt.status === "CANCELLED" || appt.status === "NO_SHOW";
                  return (
                    <button
                      type="button"
                      key={appt.id}
                      className={`${css.card} ${cardHeight < 38 ? css.cardCompact : ""} ${
                        drag?.active && drag.appointmentId === appt.id ? css.cardDragging : ""
                      }`}
                      style={{
                        top,
                        height: cardHeight,
                        left: 3,
                        right: 3,
                        borderLeftColor: barberColor(appt.barberId ?? barber.id),
                        opacity: dim ? 0.55 : 1,
                      }}
                      title={`${minuteToLabel(start)} · ${appt.clientName ?? ""} · ${ui.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      onPointerDown={(e) => onPointerDown(e, appt)}
                      onPointerMove={(e) => onPointerMove(e, appt)}
                      onPointerUp={(e) => onPointerUp(e, appt)}
                      onPointerCancel={() => setDrag(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          props.onCardClick(appt);
                        }
                      }}
                    >
                      <span className={css.cardTime}>{minuteToLabel(start)}</span>
                      <span className={css.cardName}>
                        {appt.clientName || t("barber.agenda.card.noClient")}
                      </span>
                      <span className={css.cardServices}>
                        {appt.services.length > 0
                          ? appt.services.map((s) => s.serviceName).join(" + ")
                          : t("barber.agenda.card.noServices")}
                      </span>
                    </button>
                  );
                })}

                {ghost ? (
                  <div
                    className={`${css.ghost} ${ghost.ok ? "" : css.ghostBad}`}
                    style={{
                      top: yOf(ghost.startMin),
                      height: Math.max(20, ghost.durationMin * PX),
                      left: 3,
                      right: 3,
                    }}
                  >
                    {ghost.ok
                      ? minuteToLabel(ghost.startMin)
                      : `${minuteToLabel(ghost.startMin)} · ${t("barber.agenda.move.blocked")}`}
                  </div>
                ) : null}

                {nowMinute !== null && nowMinute >= bounds.start && nowMinute <= bounds.end ? (
                  <div className={css.nowLine} style={{ top: yOf(nowMinute) }}>
                    <span className={css.nowDot} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Los huecos que NO cubre ninguna ventana de trabajo, dentro de la rejilla. */
function complement(windows: MinuteWindow[], bounds: MinuteWindow): MinuteWindow[] {
  const out: MinuteWindow[] = [];
  let cursor = bounds.start;
  for (const w of windows) {
    const start = Math.max(bounds.start, w.start);
    const end = Math.min(bounds.end, w.end);
    if (end <= cursor) continue;
    if (start > cursor) out.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < bounds.end) out.push({ start: cursor, end: bounds.end });
  return out;
}
