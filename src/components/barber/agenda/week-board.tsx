"use client";

// ═══════════════════════════════════════════════════════════════════════
// Vista SEMANA — para ver de un vistazo dónde queda hueco. Una columna por
// día, con todos los barberos visibles mezclados (el punto de color dice
// quién es; el fondo y la barra, en qué estado va). Con el filtro de sillas
// se ve la semana de UN barbero.
//
// Lo mismo que la vista Día, en lo que aplica (como el dental):
//  · rejilla con horas y medias horas, lo que nadie trabaja rayado, los
//    bloqueos de toda la barbería (y los del barbero filtrado) y «ahora»;
//  · al pasar el mouse por un hueco, la hora y cuántos barberos están
//    libres («+ 10:30 a. m. · 2 libres»); en rojo si no hay nadie. El clic
//    abre «Nueva visita» ese día, a esa hora, con el primer barbero libre;
//  · arrastrar una visita la mueve de hora y de DÍA con el MISMO barbero
//    (cambiar de barbero se hace en la vista Día o en el detalle — igual que
//    la semana del dental, donde el doctor no cambia); jalar su borde de
//    abajo la alarga;
//  · el resumen al pasar el mouse y la acción rápida en la visita.
//
// Tocar el encabezado de un día lleva a la vista Día de ese día.
// Los bloques son proporcionales (1.1 px por minuto).
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BARBER_TIME_OFF_TYPE_LABELS,
  isTerminalAppointmentStatus,
  type BarberAppointmentDTO,
  type BarberDTO,
  type BarberScheduleDTO,
  type BarberTimeOffDTO,
} from "@/lib/barber/types";
import {
  BARBER_CARD_MIN_PX,
  BARBER_SLOT_MINUTES,
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
  type BarberSlotCheck,
  type MinuteWindow,
} from "@/lib/barber/agenda";
import {
  freeBarbersAt,
  rulerMarks,
  slotAtOffset,
  slotIssueText,
  slotVerdict,
  weekClosedBands,
} from "./rejilla";
import { ClosedBands, DragGhost, GridLines, NowLine, TimeOffBand } from "./rejilla-piezas";
import { useCardDrag } from "./use-card-drag";
import { AppointmentCard, type CardQuickAction } from "./appointment-card";
import { agendaCss as css } from "./agenda-ui";

const PX = BARBER_WEEK_PX_PER_MIN;

export interface WeekBoardProps {
  dateISO: string;
  timezone: string;
  /** Los barberos VISIBLES (ya filtrados por la silla elegida). */
  barbers: BarberDTO[];
  appointments: BarberAppointmentDTO[];
  schedules: BarberScheduleDTO[];
  timeOff: BarberTimeOffDTO[];
  charged: Record<string, { saleId: string; total: number }>;
  canEdit: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onPickDay: (dateISO: string) => void;
  onCardClick: (appointment: BarberAppointmentDTO) => void;
  onSlotClick: (barberId: string | null, startAt: Date) => void;
  onSlotRejected: (message: string) => void;
  onMove: (appointment: BarberAppointmentDTO, startAt: Date, barberId: string) => void;
  onResize: (appointment: BarberAppointmentDTO, durationMin: number) => void;
  onDropRejected: (message: string) => void;
  onDragStart?: () => void;
  onCardHover?: (
    appointment: BarberAppointmentDTO,
    el: HTMLElement,
    e: { clientX: number; clientY: number },
  ) => void;
  onCardHoverEnd?: () => void;
  quickAction?: (appointment: BarberAppointmentDTO) => CardQuickAction | null;
  onQuickAction?: (appointment: BarberAppointmentDTO) => void;
  busyId?: string | null;
}

interface WeekGuide {
  day: string;
  startMin: number;
  ok: boolean;
  text: string;
  /** Barbero que se propone al hacer clic (el primero libre). */
  barberId: string | null;
}

export function WeekBoard(props: WeekBoardProps) {
  const { dateISO, timezone, barbers, appointments, schedules, timeOff, charged, canEdit, t } = props;
  const days = useMemo(() => weekDaysISO(dateISO), [dateISO]);
  const todayISO = shopDateISO(new Date(), timezone);

  const active = useMemo(() => barbers.filter((b) => b.isActive), [barbers]);
  const activeIds = useMemo(() => active.map((b) => b.id), [active]);
  const nameOf = useCallback(
    (id: string | null) => {
      const b = active.find((x) => x.id === id);
      return b ? b.nickname || b.name : "";
    },
    [active],
  );

  const perDay = useMemo(() => {
    return days.map((day) => {
      const dayStartUtc = shopLocalToUtc(day, 0, timezone).getTime();
      const dayEndUtc = shopLocalToUtc(day, 24 * 60, timezone).getTime();
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
      for (const id of activeIds) windows.push(...barberDayWindows(schedules, id, weekday));
      return { day, dayStartUtc, dayEndUtc, weekday, items, windows };
    });
  }, [days, timezone, appointments, activeIds, schedules]);

  const dayStartOf = useMemo(() => new Map(perDay.map((d) => [d.day, d.dayStartUtc])), [perDay]);

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
  const yOf = useCallback((minute: number) => (minute - bounds.start) * PX, [bounds.start]);
  const marks = rulerMarks(bounds, PX);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── «Ahora» (solo en la columna de hoy) ──────────────────────────────
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const todayStart = dayStartOf.get(todayISO) ?? null;
  const nowMinute = todayStart === null ? null : (nowMs - todayStart) / 60_000;
  const nowVisible = nowMinute !== null && nowMinute >= bounds.start && nowMinute <= bounds.end;

  // Como en Día: si la semana trae HOY, se abre en la hora actual (una vez).
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (nowMinute === null || scrolledFor.current === days[0]) return;
    const scroller = scrollerRef.current;
    const column = columnRefs.current.get(todayISO);
    if (!scroller || !column) return;
    scrolledFor.current = days[0];
    const columnTop =
      column.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = Math.max(0, columnTop + (nowMinute - bounds.start) * PX - scroller.clientHeight / 3);
  }, [nowMinute, days, todayISO, bounds.start]);

  // ── Validar (lo mismo que el servidor) ───────────────────────────────
  const slotCtx = useMemo(
    () => ({ timezone, schedules, timeOff, appointments }),
    [timezone, schedules, timeOff, appointments],
  );
  const issueText = useCallback(
    (check: BarberSlotCheck) => {
      const issue = slotIssueText(check, {
        ...slotCtx,
        clientNameOf: (id) => appointments.find((a) => a.id === id)?.clientName ?? null,
      });
      return issue ? t(issue.key, issue.vars) : "";
    },
    [slotCtx, appointments, t],
  );

  // ── Arrastrar: otra hora u otro día, MISMO barbero ───────────────────
  const canDrag = useCallback(
    (appt: BarberAppointmentDTO) =>
      canEdit && Boolean(appt.barberId) && !isTerminalAppointmentStatus(appt.status),
    [canEdit],
  );
  const drag = useCardDrag({
    pxPerMin: PX,
    boundsStart: bounds.start,
    boundsEnd: bounds.end,
    scrollerRef,
    columnRefs,
    homeColumn: (appt) => shopDateISO(new Date(appt.startAt), timezone),
    resolveColumn: (day, appt) => {
      const dayStartUtc = dayStartOf.get(day);
      return dayStartUtc !== undefined && appt.barberId ? { barberId: appt.barberId, dayStartUtc } : null;
    },
    verdict: (appt, target) => {
      const check = slotVerdict(slotCtx, { ...target, excludeAppointmentId: appt.id });
      return { ok: check.ok, reason: check.ok ? "" : issueText(check) };
    },
    canDrag,
    onMove: props.onMove,
    onResize: props.onResize,
    onRejected: (_appt, p) =>
      props.onDropRejected(
        p.mode === "resize"
          ? t("barber.agenda.resize.rejected", { reason: p.reason })
          : t("barber.agenda.move.rejected", { time: minuteToLabel(p.startMin), reason: p.reason }),
      ),
    onStart: () => {
      setGuide(null);
      props.onDragStart?.();
    },
  });
  const preview = drag.preview;

  // ── Hueco bajo el mouse ──────────────────────────────────────────────
  const [guide, setGuide] = useState<WeekGuide | null>(null);

  const slotUnder = useCallback(
    (e: { clientY: number; target: EventTarget | null; currentTarget: EventTarget }, day: string): WeekGuide | null => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-card]")) return null;
      const dayStartUtc = dayStartOf.get(day);
      if (dayStartUtc === undefined || activeIds.length === 0) return null;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const startMin = slotAtOffset({
        offsetY: e.clientY - rect.top,
        boundsStart: bounds.start,
        boundsEnd: bounds.end,
        pxPerMin: PX,
      });
      const args = { dayStartUtc, startMin, durationMin: BARBER_SLOT_MINUTES };
      const free = freeBarbersAt(slotCtx, activeIds, args);
      const time = minuteToLabel(startMin);
      if (free.length > 0) {
        const who =
          activeIds.length === 1
            ? nameOf(free[0])
            : t("barber.agenda.slot.freeCount", { count: free.length });
        return { day, startMin, ok: true, text: `+ ${time} · ${who}`, barberId: free[0] };
      }
      // Con un solo barbero visible se dice POR QUÉ; con varios, que nadie.
      const reason =
        activeIds.length === 1
          ? issueText(slotVerdict(slotCtx, { barberId: activeIds[0], ...args }))
          : t("barber.agenda.slot.nobodyFree");
      return { day, startMin, ok: false, text: `${time} · ${reason}`, barberId: null };
    },
    [dayStartOf, activeIds, bounds.start, bounds.end, slotCtx, nameOf, issueText, t],
  );

  const onColumnPointerMove = (e: React.PointerEvent, day: string) => {
    if (!canEdit || e.pointerType !== "mouse" || e.buttons !== 0 || drag.isDragging()) {
      if (guide) setGuide(null);
      return;
    }
    const next = slotUnder(e, day);
    setGuide((prev) =>
      prev && next && prev.day === next.day && prev.startMin === next.startMin && prev.ok === next.ok
        ? prev
        : next,
    );
  };

  const onColumnClick = (e: React.MouseEvent, day: string) => {
    if (drag.consumeClick()) return;
    if (!canEdit || drag.isDragging()) return;
    const slot = slotUnder(e, day);
    if (!slot) return;
    setGuide(null);
    if (!slot.ok) {
      props.onSlotRejected(slot.text);
      return;
    }
    const dayStartUtc = dayStartOf.get(day) as number;
    props.onSlotClick(slot.barberId, new Date(dayStartUtc + slot.startMin * 60_000));
  };

  // Bloqueos que se pintan en Semana: los de toda la barbería siempre; los
  // de un barbero solo si es el único a la vista (mezclados confundirían).
  const visibleTimeOff = useMemo(
    () =>
      timeOff.filter(
        (off) => off.barberId === null || (activeIds.length === 1 && off.barberId === activeIds[0]),
      ),
    [timeOff, activeIds],
  );

  return (
    <div className={css.board}>
      <div className={css.scroller} ref={scrollerRef} data-scroller="">
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
            {marks.map(({ minute }) => (
              <span key={minute} className={css.gutterMark} style={{ top: Math.max(7, yOf(minute)) }}>
                {minuteToHourLabel(minute)}
              </span>
            ))}
          </div>

          {perDay.map(({ day, dayStartUtc, dayEndUtc, weekday, items }) => {
            const lanes = assignLanes(items.map((i) => ({ start: i.start, end: i.end })));
            const isToday = day === todayISO;
            const closed = weekClosedBands(schedules, activeIds, weekday, bounds);
            const colGuide = guide && guide.day === day ? guide : null;
            const ghost = preview && preview.colKey === day ? preview : null;
            return (
              <div
                key={day}
                ref={(node) => {
                  if (node) columnRefs.current.set(day, node);
                  else columnRefs.current.delete(day);
                }}
                className={[
                  css.column,
                  isToday ? css.weekTodayCol : "",
                  colGuide ? (colGuide.ok ? css.columnPick : css.columnBlocked) : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ height }}
                onClick={(e) => onColumnClick(e, day)}
                onPointerMove={(e) => onColumnPointerMove(e, day)}
                onPointerLeave={() => setGuide(null)}
                data-col={day}
                data-bounds-start={bounds.start}
                data-px={PX}
              >
                <GridLines marks={marks} yOf={yOf} end={bounds.end} />
                <ClosedBands bands={closed} yOf={yOf} pxPerMin={PX} />

                {visibleTimeOff.map((off) => {
                  const s = Math.max(new Date(off.startAt).getTime(), dayStartUtc);
                  const e = Math.min(new Date(off.endAt).getTime(), dayEndUtc);
                  if (e <= s) return null;
                  const start = Math.max(bounds.start, (s - dayStartUtc) / 60_000);
                  const end = Math.min(bounds.end, (e - dayStartUtc) / 60_000);
                  if (end <= start) return null;
                  const reason = off.reason || BARBER_TIME_OFF_TYPE_LABELS[off.type];
                  return (
                    <TimeOffBand
                      key={`t-${off.id}`}
                      top={yOf(start)}
                      height={Math.max(14, (end - start) * PX)}
                      wholeShop={off.barberId === null}
                      text={off.barberId === null ? `${t("barber.agenda.slot.shopClosed")} · ${reason}` : reason}
                    />
                  );
                })}

                {colGuide ? (
                  <div
                    className={`${css.slotGuide} ${colGuide.ok ? "" : css.slotGuideBad}`}
                    data-slot-guide={colGuide.ok ? "ok" : "bad"}
                    style={{ top: yOf(colGuide.startMin), height: BARBER_SLOT_MINUTES * PX, left: 2, right: 2 }}
                    aria-hidden
                  >
                    <span className={css.slotGuideText}>{colGuide.text}</span>
                  </div>
                ) : null}

                {items.map((item, index) => {
                  const appt = item.appointment;
                  const lane = lanes[index];
                  return (
                    <AppointmentCard
                      key={appt.id}
                      appointment={appt}
                      variant="week"
                      top={yOf(Math.max(bounds.start, item.start))}
                      height={Math.max(
                        BARBER_CARD_MIN_PX,
                        (Math.min(bounds.end, item.end) - Math.max(bounds.start, item.start)) * PX,
                      )}
                      lane={lane?.lane ?? 0}
                      laneCount={lane?.lanes ?? 1}
                      startLabel={minuteToLabel(item.start)}
                      endLabel={minuteToLabel(item.end)}
                      barberName={appt.barberName ?? t("barber.agenda.card.noBarber")}
                      sale={charged[appt.id] ?? null}
                      dragging={preview?.appointmentId === appt.id}
                      draggable={canDrag(appt)}
                      quick={props.quickAction?.(appt) ?? null}
                      busy={props.busyId === appt.id}
                      onQuick={() => props.onQuickAction?.(appt)}
                      t={t}
                      onOpen={() => {
                        if (drag.consumeClick()) return;
                        props.onCardClick(appt);
                      }}
                      onPointerDown={(e) => drag.begin(e, appt, "move")}
                      onResizeDown={(e) => drag.begin(e, appt, "resize")}
                      onHoverStart={
                        props.onCardHover ? (el, e) => props.onCardHover?.(appt, el, e) : undefined
                      }
                      onHoverEnd={() => props.onCardHoverEnd?.()}
                    />
                  );
                })}

                {ghost ? (
                  <DragGhost
                    preview={ghost}
                    top={yOf(ghost.startMin)}
                    height={Math.max(BARBER_CARD_MIN_PX, ghost.durationMin * PX)}
                    left="2px"
                    width="calc(100% - 4px)"
                    barberName={nameOf(ghost.barberId)}
                    compact
                    t={t}
                  />
                ) : null}

                {isToday && nowVisible ? <NowLine top={yOf(nowMinute as number)} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
