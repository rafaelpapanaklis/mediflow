"use client";

// ═══════════════════════════════════════════════════════════════════════
// Vista DÍA — la pantalla que la barbería tiene abierta todo el día.
// Una columna por silla, arrastrar para mover, tocar un hueco para agendar.
//
// El bloque de cada visita mide LO QUE DURA: 2 px por minuto (30 min = 60
// px, 90 min = 180 px). Antes todas se veían igual de "franjita" y la
// agenda no decía lo único que importa de un vistazo: cuánto va a tomar.
//
// El arrastre es con eventos de puntero a pelo (no @dnd-kit) por dos
// razones: la rejilla tendría cientos de zonas soltables (15 min × N
// barberos) y, sobre todo, hay que VALIDAR el hueco mientras el dedo se
// mueve para pintar el fantasma en rojo ANTES de soltar. La validación es
// la misma función que corre el servidor: checkAppointmentSlot(). Vive en
// use-card-drag.ts (mover Y alargar por el borde de abajo, también en la
// vista Semana); las cuentas, en rejilla.ts.
//
// Al pasar el mouse por un hueco se resalta DÓNDE se agendaría, con la
// hora y el barbero, o en rojo con el motivo si ahí no se puede — como el
// dental. El clic usa exactamente la misma cuenta que el resalte.
//
// Tocar una tarjeta SIEMPRE abre el detalle — también las cerradas
// (completada, cancelada, no llegó) y también sin permiso de edición. Antes
// el clic vivía dentro del arrastre, y como el arrastre se cancela para
// esas visitas, tocarlas no hacía absolutamente nada. Justo la completada
// es la que hay que abrir para cobrarla.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
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
  BARBER_DAY_PX_PER_MIN,
  BARBER_SLOT_MINUTES,
  assignLanes,
  barberDayWindows,
  computeGridBounds,
  hasAnySchedule,
  minuteToHHMM,
  minuteToHourLabel,
  minuteToLabel,
  shopDateISO,
  shopLocalToUtc,
  weekdayOfISO,
  type MinuteWindow,
} from "@/lib/barber/agenda";
import type { BarberSlotCheck } from "@/lib/barber/agenda";
import {
  complementWindows,
  halfHourLabel,
  rulerMarks,
  slotAtOffset,
  slotIssueText,
  slotVerdict,
} from "./rejilla";
import { ClosedBands, DragGhost, GridLines, NowLine, TimeOffBand } from "./rejilla-piezas";
import { useCardDrag } from "./use-card-drag";
import { agendaCss as css, barberColor, initials } from "./agenda-ui";
import { AppointmentCard, type CardQuickAction } from "./appointment-card";

export interface DayBoardProps {
  dateISO: string;
  timezone: string;
  barbers: BarberDTO[];
  appointments: BarberAppointmentDTO[];
  schedules: BarberScheduleDTO[];
  timeOff: BarberTimeOffDTO[];
  /** appointmentId → ticket vivo. Lo calcula el servidor con isSaleCancelled(). */
  charged: Record<string, { saleId: string; total: number }>;
  canEdit: boolean;
  canSchedule: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onSlotClick: (barberId: string, startAt: Date) => void;
  /** Clic en un hueco que no vale: la pantalla avisa por qué (no abre nada). */
  onSlotRejected: (message: string) => void;
  onCardClick: (appointment: BarberAppointmentDTO) => void;
  onMove: (appointment: BarberAppointmentDTO, startAt: Date, barberId: string) => void;
  /** Se jaló el borde de abajo: nueva duración en minutos. */
  onResize: (appointment: BarberAppointmentDTO, durationMin: number) => void;
  /** Se soltó donde no cabe: la visita no se movió, aviso con el motivo. */
  onDropRejected: (message: string) => void;
  onDragStart?: () => void;
  /** Resumen al pasar el mouse (solo mouse). */
  onCardHover?: (
    appointment: BarberAppointmentDTO,
    el: HTMLElement,
    e: { clientX: number; clientY: number },
  ) => void;
  onCardHoverEnd?: () => void;
  /** La acción rápida del estado siguiente para esta visita (o null). */
  quickAction?: (appointment: BarberAppointmentDTO) => CardQuickAction | null;
  onQuickAction?: (appointment: BarberAppointmentDTO) => void;
  /** Visita con una acción rápida en curso (su botón se deshabilita). */
  busyId?: string | null;
}

const PX = BARBER_DAY_PX_PER_MIN;

/** El hueco señalado con el mouse: dónde, si vale y, si no, por qué. */
interface SlotGuideState {
  barberId: string;
  startMin: number;
  ok: boolean;
  reason: string;
}

export function DayBoard(props: DayBoardProps) {
  const { dateISO, timezone, barbers, appointments, schedules, timeOff, charged, canEdit, t } = props;

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
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /** Día para el que ya se desplazó la rejilla a «ahora» (una vez por día). */
  const scrolledFor = useRef<string | null>(null);
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

  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Al abrir HOY la rejilla se acomoda en la hora actual (con un tercio de
  // la pantalla de margen hacia arriba), en vez de abrir siempre a las 9 a. m.
  // Una sola vez por día visto: el refresco de cada minuto no debe quitarle
  // el scroll a quien está revisando otra hora.
  useEffect(() => {
    if (nowMinute === null || scrolledFor.current === dateISO) return;
    const scroller = scrollerRef.current;
    const column = columnRefs.current.values().next().value as HTMLDivElement | undefined;
    if (!scroller || !column) return;
    scrolledFor.current = dateISO;
    const columnTop =
      column.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const target = columnTop + (nowMinute - bounds.start) * PX - scroller.clientHeight / 3;
    scroller.scrollTop = Math.max(0, target);
  }, [nowMinute, dateISO, bounds.start]);

  // ── Validar un hueco (lo mismo que el servidor) ──────────────────────
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

  // ── Arrastrar para mover / jalar el borde para alargar ───────────────
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
    // En Día cada columna es un barbero; el día es siempre el que se ve.
    homeColumn: (appt) => appt.barberId,
    resolveColumn: (colKey) =>
      columns.some((b) => b.id === colKey) ? { barberId: colKey, dayStartUtc } : null,
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

  // ── Huecos: señalar con el mouse y tocar para agendar ────────────────
  // El resalte y el clic usan LA MISMA cuenta (slotAtOffset + slotVerdict):
  // lo que se ve señalado es exactamente lo que se abre. Un hueco que no
  // vale (fuera de horario, bloqueado, ocupado) se pinta en rojo con el
  // motivo ANTES del clic, y el clic ahí no abre nada: avisa por qué.
  const [guide, setGuide] = useState<SlotGuideState | null>(null);

  const slotUnder = useCallback(
    (e: { clientY: number; target: EventTarget | null; currentTarget: EventTarget }, barberId: string) => {
      // Sobre una visita el clic abre ESA visita, no agenda otra.
      if ((e.target as HTMLElement | null)?.closest?.("[data-card]")) return null;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const startMin = slotAtOffset({
        offsetY: e.clientY - rect.top,
        boundsStart: bounds.start,
        boundsEnd: bounds.end,
        pxPerMin: PX,
      });
      const check = slotVerdict(slotCtx, {
        barberId,
        dayStartUtc,
        startMin,
        durationMin: BARBER_SLOT_MINUTES,
      });
      return { barberId, startMin, ok: check.ok, reason: check.ok ? "" : issueText(check) };
    },
    [bounds.start, bounds.end, slotCtx, dayStartUtc, issueText],
  );

  const onColumnPointerMove = (e: React.PointerEvent, barberId: string) => {
    // Solo con mouse y sin botón apretado: con el dedo no hay «pasar por
    // encima», y con el botón apretado se está arrastrando una visita.
    if (!canEdit || e.pointerType !== "mouse" || e.buttons !== 0 || drag.isDragging()) {
      if (guide) setGuide(null);
      return;
    }
    const next = slotUnder(e, barberId);
    setGuide((prev) =>
      prev && next && prev.barberId === next.barberId && prev.startMin === next.startMin && prev.ok === next.ok
        ? prev
        : next,
    );
  };

  const onColumnClick = (e: React.MouseEvent, barberId: string) => {
    // La cola de un arrastre que terminó fuera de la tarjeta no agenda nada.
    if (drag.consumeClick()) return;
    if (!canEdit || drag.isDragging()) return;
    const slot = slotUnder(e, barberId);
    if (!slot) return;
    setGuide(null);
    if (!slot.ok) {
      props.onSlotRejected(`${minuteToLabel(slot.startMin)} · ${slot.reason}`);
      return;
    }
    props.onSlotClick(barberId, new Date(dayStartUtc + slot.startMin * 60_000));
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

  const marks = rulerMarks(bounds, PX);
  const nowVisible = nowMinute !== null && nowMinute >= bounds.start && nowMinute <= bounds.end;

  return (
    <div className={css.board}>
      <div className={css.scroller} ref={scrollerRef} data-scroller="">
        <div
          className={css.grid}
          // El mínimo de cada columna lo pone el CSS (0 en escritorio, legible en
          // celular, donde la rejilla se desplaza de lado con la hora fija).
          style={{ gridTemplateColumns: `58px repeat(${columns.length}, minmax(var(--agenda-col-min, 0px), 1fr))` }}
        >
          {/* Encabezado */}
          <div className={css.headCorner} />
          {columns.map((barber) => {
            const windows = windowsByBarber.get(barber.id) ?? [];
            const configured = hasAnySchedule(schedules, barber.id);
            const count = appointments.filter(
              (a) => a.barberId === barber.id && a.status !== "CANCELLED",
            ).length;
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
                  {count > 0 ? <span className={css.headCount}>{count}</span> : null}
                </div>
                {!configured ? (
                  // El aviso LLEVA a arreglarlo, con este barbero ya elegido.
                  props.canSchedule ? (
                    <Link
                      href={`/barber/agenda/horarios?barbero=${barber.id}`}
                      className={css.headMetaLink}
                    >
                      <CalendarPlus size={11} />
                      {t("barber.agenda.state.noScheduleAction")}
                    </Link>
                  ) : (
                    <div className={css.headMeta}>{t("barber.agenda.state.noSchedule")}</div>
                  )
                ) : (
                  <div className={css.headMeta}>
                    {windows.length === 0
                      ? t("barber.agenda.schedule.closedDay")
                      : windows
                          .map((w) => `${minuteToLabel(w.start)} – ${minuteToLabel(w.end)}`)
                          .join(" · ")}
                  </div>
                )}
              </div>
            );
          })}

          {/* Regleta de horas */}
          <div className={css.gutter} style={{ height, position: "relative" }}>
            {marks.map(({ minute, kind }) => (
              <span
                key={minute}
                className={kind === "hour" ? css.gutterMark : css.gutterHalf}
                style={{ top: Math.max(7, yOf(minute)) }}
              >
                {kind === "hour" ? minuteToHourLabel(minute) : halfHourLabel(minute)}
              </span>
            ))}
            {nowVisible ? (
              // 24 h en la píldora del "ahora": es la etiqueta más angosta y
              // aquí compite por el mismo ancho que la regleta.
              <span className={css.nowLabel} style={{ top: yOf(nowMinute as number) }}>
                {minuteToHHMM(Math.round(nowMinute as number))}
              </span>
            ) : null}
          </div>

          {/* Columnas */}
          {columns.map((barber) => {
            const windows = windowsByBarber.get(barber.id) ?? [];
            const configured = hasAnySchedule(schedules, barber.id);
            const closed = configured ? complementWindows(windows, bounds) : [];
            const blocks = timeOff.filter((off) => off.barberId === null || off.barberId === barber.id);
            const cards = appointments
              .filter((a) => a.barberId === barber.id)
              .sort((a, b) => a.startAt.localeCompare(b.startAt));
            // Una cancelada NO bloquea la agenda, así que sí se puede
            // encimar con la visita que la sustituyó: hacen falta carriles.
            const lanes = assignLanes(
              cards.map((a) => ({ start: toMinutes(a.startAt), end: toMinutes(a.endAt) })),
            );
            const ghost = preview && preview.colKey === barber.id ? preview : null;
            const colGuide = guide && guide.barberId === barber.id ? guide : null;
            const barberLabel = barber.nickname || barber.name;

            return (
              <div
                key={barber.id}
                ref={(node) => {
                  if (node) columnRefs.current.set(barber.id, node);
                  else columnRefs.current.delete(barber.id);
                }}
                className={[
                  css.column,
                  colGuide ? (colGuide.ok ? css.columnPick : css.columnBlocked) : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ height }}
                onClick={(e) => onColumnClick(e, barber.id)}
                onPointerMove={(e) => onColumnPointerMove(e, barber.id)}
                onPointerLeave={() => setGuide(null)}
                data-col={barber.id}
                data-bounds-start={bounds.start}
                data-px={PX}
              >
                <GridLines marks={marks} yOf={yOf} end={bounds.end} />

                <ClosedBands
                  bands={closed}
                  yOf={yOf}
                  pxPerMin={PX}
                  label={configured && windows.length === 0 ? t("barber.agenda.schedule.closedDay") : null}
                />

                {blocks.map((off) => {
                  const start = Math.max(bounds.start, toMinutes(off.startAt));
                  const end = Math.min(bounds.end, toMinutes(off.endAt));
                  if (end <= start) return null;
                  const reason = off.reason || BARBER_TIME_OFF_TYPE_LABELS[off.type];
                  return (
                    <TimeOffBand
                      key={`t-${off.id}`}
                      top={yOf(start)}
                      height={Math.max(14, (end - start) * PX)}
                      wholeShop={off.barberId === null}
                      text={
                        off.barberId === null
                          ? `${t("barber.agenda.slot.shopClosed")} · ${reason}`
                          : reason
                      }
                    />
                  );
                })}

                {/* El hueco que se agendaría con el clic. Debajo de las visitas. */}
                {colGuide ? (
                  <div
                    className={`${css.slotGuide} ${colGuide.ok ? "" : css.slotGuideBad}`}
                    data-slot-guide={colGuide.ok ? "ok" : "bad"}
                    style={{ top: yOf(colGuide.startMin), height: BARBER_SLOT_MINUTES * PX }}
                    aria-hidden
                  >
                    <span className={css.slotGuideText}>
                      {colGuide.ok
                        ? `+ ${minuteToLabel(colGuide.startMin)} · ${barberLabel}`
                        : `${minuteToLabel(colGuide.startMin)} · ${colGuide.reason}`}
                    </span>
                  </div>
                ) : null}

                {cards.map((appt, index) => (
                  <AppointmentCard
                    key={appt.id}
                    appointment={appt}
                    variant="day"
                    top={yOf(Math.max(bounds.start, toMinutes(appt.startAt)))}
                    height={cardHeightPx(toMinutes(appt.startAt), toMinutes(appt.endAt), bounds)}
                    lane={lanes[index]?.lane ?? 0}
                    laneCount={lanes[index]?.lanes ?? 1}
                    startLabel={minuteToLabel(toMinutes(appt.startAt))}
                    endLabel={minuteToLabel(toMinutes(appt.endAt))}
                    barberName={appt.barberName || barber.nickname || barber.name}
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
                    onHoverStart={props.onCardHover ? (el, e) => props.onCardHover?.(appt, el, e) : undefined}
                    onHoverEnd={() => props.onCardHoverEnd?.()}
                  />
                ))}

                {ghost ? (
                  <DragGhost
                    preview={ghost}
                    top={yOf(ghost.startMin)}
                    height={Math.max(BARBER_CARD_MIN_PX, ghost.durationMin * PX)}
                    left="3px"
                    width="calc(100% - 6px)"
                    barberName={barberLabel}
                    t={t}
                  />
                ) : null}

                {nowVisible ? <NowLine top={yOf(nowMinute as number)} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Alto en px del bloque, recortado a la ventana visible de la rejilla. */
function cardHeightPx(startMin: number, endMin: number, bounds: MinuteWindow): number {
  const visible = Math.min(bounds.end, endMin) - Math.max(bounds.start, startMin);
  return Math.max(BARBER_CARD_MIN_PX, visible * PX);
}
