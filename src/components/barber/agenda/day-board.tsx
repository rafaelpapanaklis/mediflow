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
// la misma función que corre el servidor: checkAppointmentSlot().
//
// Tocar una tarjeta SIEMPRE abre el detalle — también las cerradas
// (completada, cancelada, no llegó) y también sin permiso de edición. Antes
// el clic vivía dentro del arrastre, y como el arrastre se cancela para
// esas visitas, tocarlas no hacía absolutamente nada. Justo la completada
// es la que hay que abrir para cobrarla.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarPlus, CheckCircle2 } from "lucide-react";
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
  BARBER_CARD_COMPACT_PX,
  BARBER_CARD_MIN_PX,
  BARBER_DAY_PX_PER_MIN,
  BARBER_SLOT_MINUTES,
  assignLanes,
  barberDayWindows,
  checkAppointmentSlot,
  computeGridBounds,
  formatMXN,
  hasAnySchedule,
  minuteToHHMM,
  minuteToHourLabel,
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
  /** appointmentId → ticket vivo. Lo calcula el servidor con isSaleCancelled(). */
  charged: Record<string, { saleId: string; total: number }>;
  canEdit: boolean;
  canSchedule: boolean;
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
  // "El clic que viene es la cola de un arrastre" — se levanta al soltar
  // después de mover y se baja en el siguiente pointerdown, así un arrastre
  // que termina fuera de la tarjeta no se come el clic siguiente.
  const justDragged = useRef(false);

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

  const columnAt = useCallback((clientX: number): string | null => {
    let best: string | null = null;
    for (const [id, node] of Array.from(columnRefs.current.entries())) {
      const rect = node.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return id;
      if (best === null) best = id;
    }
    return best;
  }, []);

  const canDrag = (appt: BarberAppointmentDTO) =>
    canEdit && Boolean(appt.barberId) && !isTerminalAppointmentStatus(appt.status);

  const onPointerDown = (e: React.PointerEvent, appt: BarberAppointmentDTO) => {
    justDragged.current = false;
    if (!canDrag(appt) || !appt.barberId) return;
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
    if (!current.active) return; // fue un toque: lo atiende onClick
    justDragged.current = true;
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
  const nowVisible = nowMinute !== null && nowMinute >= bounds.start && nowMinute <= bounds.end;

  return (
    <div className={css.board}>
      <div className={css.scroller}>
        <div
          className={css.grid}
          style={{ gridTemplateColumns: `58px repeat(${columns.length}, minmax(0, 1fr))` }}
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
            {hourMarks.map((m) => (
              <span key={m} className={css.gutterMark} style={{ top: Math.max(7, yOf(m)) }}>
                {minuteToHourLabel(m)}
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
            const closed = configured ? complement(windows, bounds) : [];
            const blocks = timeOff.filter((off) => off.barberId === null || off.barberId === barber.id);
            const cards = appointments
              .filter((a) => a.barberId === barber.id)
              .sort((a, b) => a.startAt.localeCompare(b.startAt));
            // Una cancelada NO bloquea la agenda, así que sí se puede
            // encimar con la visita que la sustituyó: hacen falta carriles.
            const lanes = assignLanes(
              cards.map((a) => ({ start: toMinutes(a.startAt), end: toMinutes(a.endAt) })),
            );
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

                {cards.map((appt, index) => (
                  <AppointmentCard
                    key={appt.id}
                    appointment={appt}
                    top={yOf(Math.max(bounds.start, toMinutes(appt.startAt)))}
                    height={cardHeightPx(toMinutes(appt.startAt), toMinutes(appt.endAt), bounds)}
                    lane={lanes[index]?.lane ?? 0}
                    laneCount={lanes[index]?.lanes ?? 1}
                    startLabel={minuteToLabel(toMinutes(appt.startAt))}
                    endLabel={minuteToLabel(toMinutes(appt.endAt))}
                    barberName={appt.barberName || barber.nickname || barber.name}
                    barberTint={barberColor(appt.barberId ?? barber.id)}
                    sale={charged[appt.id] ?? null}
                    dragging={Boolean(drag?.active && drag.appointmentId === appt.id)}
                    draggable={canDrag(appt)}
                    t={t}
                    onOpen={() => {
                      if (justDragged.current) {
                        justDragged.current = false;
                        return;
                      }
                      props.onCardClick(appt);
                    }}
                    onPointerDown={(e) => onPointerDown(e, appt)}
                    onPointerMove={(e) => onPointerMove(e, appt)}
                    onPointerUp={(e) => onPointerUp(e, appt)}
                    onPointerCancel={() => setDrag(null)}
                  />
                ))}

                {ghost ? (
                  <div
                    className={`${css.ghost} ${ghost.ok ? "" : css.ghostBad}`}
                    style={{
                      top: yOf(ghost.startMin),
                      height: Math.max(BARBER_CARD_MIN_PX, ghost.durationMin * PX),
                      left: 3,
                      right: 3,
                    }}
                  >
                    {ghost.ok
                      ? `${minuteToLabel(ghost.startMin)} – ${minuteToLabel(ghost.startMin + ghost.durationMin)}`
                      : `${minuteToLabel(ghost.startMin)} · ${t("barber.agenda.move.blocked")}`}
                  </div>
                ) : null}

                {nowVisible ? (
                  <div className={css.nowLine} style={{ top: yOf(nowMinute as number) }}>
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

/** Alto en px del bloque, recortado a la ventana visible de la rejilla. */
function cardHeightPx(startMin: number, endMin: number, bounds: MinuteWindow): number {
  const visible = Math.min(bounds.end, endMin) - Math.max(bounds.start, startMin);
  return Math.max(BARBER_CARD_MIN_PX, visible * PX);
}

interface CardProps {
  appointment: BarberAppointmentDTO;
  top: number;
  height: number;
  lane: number;
  laneCount: number;
  startLabel: string;
  endLabel: string;
  barberName: string;
  barberTint: string;
  sale: { saleId: string; total: number } | null;
  dragging: boolean;
  draggable: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onOpen: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

/**
 * Bloque de una visita. Es un <button> de verdad: se abre con Enter y con
 * espacio, y el foco se ve. Nada de div con onClick.
 */
function AppointmentCard(props: CardProps) {
  const { appointment: appt, t } = props;
  const ui = BARBER_APPOINTMENT_STATUS_UI[appt.status];
  const compact = props.height < BARBER_CARD_COMPACT_PX;
  const roomy = props.height >= 74 && props.laneCount === 1;
  /** Poco alto o partida en carriles: no cabe el texto del estado. */
  const narrow = compact || props.laneCount > 1;
  const total = appt.services.reduce((acc, s) => acc + s.priceAtBooking, 0);

  const now = Date.now();
  const startMs = new Date(appt.startAt).getTime();
  const endMs = new Date(appt.endAt).getTime();
  const terminal = isTerminalAppointmentStatus(appt.status);
  const live = !terminal && startMs <= now && now < endMs;
  const past = !terminal && !live && endMs <= now;

  const width = 100 / props.laneCount;
  const clientLabel = appt.clientName || t("barber.agenda.card.noClient");
  const serviceLabel =
    appt.services.length > 0
      ? appt.services.map((s) => s.serviceName).join(" + ")
      : t("barber.agenda.card.noServices");

  return (
    <button
      type="button"
      data-status={appt.status}
      className={[
        css.card,
        compact ? css.cardCompact : "",
        props.dragging ? css.cardDragging : "",
        live ? css.cardLive : "",
        past ? css.cardPast : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        top: props.top,
        height: props.height,
        left: `calc(${props.lane * width}% + 3px)`,
        width: `calc(${width}% - 6px)`,
        cursor: props.draggable ? "grab" : "pointer",
      }}
      aria-label={t("barber.agenda.card.aria", {
        time: props.startLabel,
        client: clientLabel,
        status: ui.label,
      })}
      title={`${props.startLabel} – ${props.endLabel} · ${clientLabel} · ${serviceLabel} · ${props.barberName} · ${ui.label}`}
      onClick={(e) => {
        e.stopPropagation();
        props.onOpen();
      }}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
    >
      <span className={css.cardRow}>
        <span className={css.cardTime}>
          {narrow ? props.startLabel : `${props.startLabel} – ${props.endLabel}`}
        </span>
        {/* Con la tarjeta partida en carriles, la palabra del estado se
            cortaría a "CANC…": ahí vale más el punto de color (el estado
            completo sigue en el title y en el aria-label). */}
        {narrow ? (
          <span className={css.cardDot} aria-hidden />
        ) : (
          <span className={css.cardStatus}>{ui.label}</span>
        )}
      </span>

      <span className={css.cardName}>{clientLabel}</span>

      {compact ? null : <span className={css.cardServices}>{serviceLabel}</span>}

      {roomy ? (
        <span className={css.cardFoot}>
          <span className={css.cardBarber}>
            <span className={css.cardBarberDot} style={{ background: props.barberTint }} aria-hidden />
            <span className={css.cardBarberName}>{props.barberName}</span>
          </span>
          {props.sale ? (
            <span className={css.cardPaid}>
              <CheckCircle2 size={11} /> {t("barber.agenda.card.charged")}
            </span>
          ) : total > 0 ? (
            <span className={css.cardPrice}>{formatMXN(total)}</span>
          ) : null}
        </span>
      ) : null}
    </button>
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
