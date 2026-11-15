// ═══════════════════════════════════════════════════════════════════════
// Las cuentas de la REJILLA de la agenda, sin React (las prueba tsx --test).
//
// Posición ↔ hora, el hueco bajo el mouse, si ahí se puede agendar, a dónde
// cae una visita que se arrastra y cuánto dura la que se alarga. Lo usan la
// vista Día y la vista Semana: una sola cuenta para el resalte, el clic y el
// fantasma, para que lo que se señala sea EXACTAMENTE lo que se agenda.
//
// ⛔ Aquí NO hay reglas de agenda. «¿Cabe?» lo contesta checkAppointmentSlot()
// de @/lib/barber/agenda, la MISMA función que corre el servidor antes de
// escribir (y detrás, la constraint EXCLUDE de Postgres). La pantalla solo
// anticipa; si se equivoca, el servidor dice que no y la visita regresa.
//
// 🔴 Todo «minuto» es minuto de pared EN LA ZONA DE LA BARBERÍA, contado
// desde la medianoche local del día de la columna (`dayStartUtc`).
// ═══════════════════════════════════════════════════════════════════════
import {
  BARBER_DURATION_STEP_MIN,
  BARBER_MAX_APPOINTMENT_MIN,
  BARBER_MIN_APPOINTMENT_MIN,
  BARBER_SLOT_MINUTES,
  barberDayWindows,
  checkAppointmentSlot,
  hasAnySchedule,
  mergeWindows,
  minuteToLabel,
  shopMinuteOfDay,
  type BarberSlotCheck,
  type BusyAppointmentLike,
  type MinuteWindow,
  type ScheduleLike,
  type TimeOffLike,
} from "@/lib/barber/agenda";
import {
  canTransition,
  isTerminalAppointmentStatus,
  nextStatuses,
  type BarberAppointmentStatus,
} from "@/lib/barber/types";
import { isOwnVisitStatus } from "@/lib/barber/own-visits";

/** Mover con el mouse empieza tras este tanto de píxeles (antes es un clic). */
export const DRAG_START_PX = 4;
/** Con el dedo, mover/alargar pide MANTENER apretado este tiempo… */
export const LONG_PRESS_MS = 450;
/** …sin desplazarse más de esto (si se mueve antes, es scroll de la agenda). */
export const LONG_PRESS_SLOP_PX = 8;
/** Zona del borde del scroller que lo desplaza solo mientras se arrastra. */
export const EDGE_SCROLL_ZONE_PX = 48;
/** Velocidad máxima de ese desplazamiento, en px por cuadro (~60 fps). */
export const EDGE_SCROLL_MAX_PX = 14;
/** Pausa antes de enseñar el resumen al pasar el mouse por una visita. */
export const HOVER_CARD_DELAY_MS = 300;
/** Margen para cruzar de la visita a su resumen sin que éste se cierre. */
export const HOVER_CARD_GRACE_MS = 220;

// ── Posición ↔ hora ────────────────────────────────────────────────────

/**
 * El hueco EN EL QUE CAE el puntero, redondeado HACIA ABAJO al paso de la
 * rejilla — el mismo criterio que la agenda del dental (`inicioDeClic`):
 * con pasos de 15 min, el puntero a las 10:07 señala las 10:00 y a las
 * 10:16, las 10:15. Lo usan el resalte y el clic, así que nunca discrepan.
 *
 * `offsetY` es la distancia en px desde el techo de la columna (que es
 * `boundsStart`). Se acota a la rejilla: el último hueco empieza un paso
 * antes de `boundsEnd`.
 */
export function slotAtOffset(args: {
  offsetY: number;
  boundsStart: number;
  boundsEnd: number;
  pxPerMin: number;
  step?: number;
}): number {
  const step = args.step && args.step > 0 ? args.step : BARBER_SLOT_MINUTES;
  if (!(args.pxPerMin > 0)) return args.boundsStart;
  const raw = args.boundsStart + Math.max(0, args.offsetY) / args.pxPerMin;
  const floored = Math.floor(raw / step) * step;
  const last = Math.max(args.boundsStart, args.boundsEnd - step);
  return Math.min(last, Math.max(args.boundsStart, floored));
}

/** Minuto (sin redondear) bajo el puntero, desde el techo de la columna. */
export function minuteAtOffset(offsetY: number, boundsStart: number, pxPerMin: number): number {
  if (!(pxPerMin > 0)) return boundsStart;
  return boundsStart + offsetY / pxPerMin;
}

// ── ¿Se puede poner una visita aquí? ───────────────────────────────────

export interface SlotContext {
  timezone: string;
  schedules: ScheduleLike[];
  timeOff: TimeOffLike[];
  appointments: BusyAppointmentLike[];
}

/**
 * Veredicto de un hueco para un barbero: la MISMA checkAppointmentSlot()
 * del servidor, alimentada con lo que la pantalla tiene cargado.
 */
export function slotVerdict(
  ctx: SlotContext,
  args: {
    barberId: string;
    dayStartUtc: number;
    startMin: number;
    durationMin: number;
    excludeAppointmentId?: string | null;
  },
): BarberSlotCheck {
  const startAt = new Date(args.dayStartUtc + args.startMin * 60_000);
  const endAt = new Date(startAt.getTime() + args.durationMin * 60_000);
  return checkAppointmentSlot({
    startAt,
    endAt,
    barberId: args.barberId,
    timezone: ctx.timezone,
    schedules: ctx.schedules,
    timeOff: ctx.timeOff,
    appointments: ctx.appointments,
    excludeAppointmentId: args.excludeAppointmentId ?? null,
  });
}

/**
 * Qué decir cuando un hueco NO vale, ya como llave de diccionario + variables
 * (la pantalla la traduce). Corto, porque va dentro del resalte y del
 * fantasma: «Fuera de su horario», «Bloqueado: Comida», «Ocupado: Juan 10:30».
 */
export function slotIssueText(
  check: BarberSlotCheck,
  ctx: Pick<SlotContext, "timezone" | "timeOff" | "appointments"> & {
    /** Nombre de quien ocupa el hueco, si la pantalla lo conoce. */
    clientNameOf?: (appointmentId: string) => string | null;
  },
): { key: string; vars?: Record<string, string> } | null {
  if (check.ok) return null;
  switch (check.issue) {
    case "OUTSIDE_SCHEDULE":
      return { key: "barber.agenda.slot.outside" };
    case "TIME_OFF": {
      const off = ctx.timeOff.find((o) => o.id === check.conflictId);
      const reason = off?.reason?.trim();
      if (off && off.barberId === null) {
        return reason
          ? { key: "barber.agenda.slot.shopClosedReason", vars: { reason } }
          : { key: "barber.agenda.slot.shopClosed" };
      }
      return reason
        ? { key: "barber.agenda.slot.timeOffReason", vars: { reason } }
        : { key: "barber.agenda.slot.timeOff" };
    }
    case "OVERLAP": {
      const other = ctx.appointments.find((a) => a.id === check.conflictId);
      if (!other) return { key: "barber.agenda.slot.busy" };
      const time = minuteToLabel(shopMinuteOfDay(new Date(other.startAt), ctx.timezone));
      const name = ctx.clientNameOf?.(other.id)?.trim();
      return name
        ? { key: "barber.agenda.slot.busyWith", vars: { client: name, time } }
        : { key: "barber.agenda.slot.busyAt", vars: { time } };
    }
    case "TOO_LONG":
      return { key: "barber.agenda.slot.tooLong" };
    case "TOO_SHORT":
      return { key: "barber.agenda.slot.tooShort" };
    case "NO_BARBER":
      return { key: "barber.agenda.slot.noBarber" };
    default:
      return { key: "barber.agenda.slot.unavailable" };
  }
}

/**
 * Semana: varios barberos en la misma columna. ¿Quiénes están libres en
 * este hueco? En el orden en que se pintan (el primero es el que se propone
 * al hacer clic).
 */
export function freeBarbersAt(
  ctx: SlotContext,
  barberIds: string[],
  args: { dayStartUtc: number; startMin: number; durationMin: number },
): string[] {
  return barberIds.filter((barberId) => slotVerdict(ctx, { barberId, ...args }).ok);
}

// ── Arrastrar para mover / jalar el borde para alargar ─────────────────

/**
 * Dónde empieza una visita que se arrastra: la hora bajo el puntero menos
 * el punto de la tarjeta por el que se agarró, en la rejilla de 15 min.
 * Se acota a la rejilla visible (no se suelta donde no se ve).
 */
export function moveStartMinute(args: {
  pointerMin: number;
  grabOffsetMin: number;
  boundsStart: number;
  boundsEnd: number;
  /** Lo que dura: la visita entera tiene que caber en la rejilla visible. */
  durationMin?: number;
  step?: number;
}): number {
  const step = args.step && args.step > 0 ? args.step : BARBER_SLOT_MINUTES;
  const snapped = Math.round((args.pointerMin - args.grabOffsetMin) / step) * step;
  const span = Math.max(step, args.durationMin ?? step);
  // El último inicio que deja caber la visita, bajado a la rejilla.
  const last = Math.max(args.boundsStart, Math.floor((args.boundsEnd - span) / step) * step);
  return Math.min(last, Math.max(args.boundsStart, snapped));
}

/**
 * Duración nueva al jalar el borde de abajo: el fin bajo el puntero, en
 * pasos de 5 min (los MISMOS del servidor: BARBER_DURATION_STEP_MIN), entre
 * el mínimo y el máximo del contrato.
 */
export function resizeDuration(args: { startMin: number; pointerMin: number }): number {
  const step = BARBER_DURATION_STEP_MIN;
  const raw = Math.round((args.pointerMin - args.startMin) / step) * step;
  return Math.min(BARBER_MAX_APPOINTMENT_MIN, Math.max(BARBER_MIN_APPOINTMENT_MIN, raw));
}

/**
 * Cuánto desplazar el scroller en este cuadro mientras se arrastra cerca
 * de su borde: 0 lejos de los bordes, más rápido cuanto más pegado.
 */
export function edgeScrollDelta(pointerY: number, top: number, bottom: number): number {
  const zone = EDGE_SCROLL_ZONE_PX;
  if (!(bottom > top)) return 0;
  if (pointerY < top + zone) {
    const depth = Math.min(1, (top + zone - pointerY) / zone);
    return -Math.ceil(depth * EDGE_SCROLL_MAX_PX);
  }
  if (pointerY > bottom - zone) {
    const depth = Math.min(1, (pointerY - (bottom - zone)) / zone);
    return Math.ceil(depth * EDGE_SCROLL_MAX_PX);
  }
  return 0;
}

/**
 * Con el dedo: ¿el gesto ya es «mover la visita», o todavía no? Mover pide
 * mantener apretado LONG_PRESS_MS sin desplazarse; si el dedo se movió antes,
 * era scroll de la agenda y la visita no se toca.
 */
export function touchGesture(elapsedMs: number, movedPx: number): "wait" | "drag" | "scroll" {
  if (movedPx > LONG_PRESS_SLOP_PX) return "scroll";
  return elapsedMs >= LONG_PRESS_MS ? "drag" : "wait";
}

// ── Franjas de la rejilla ──────────────────────────────────────────────

/** Los huecos que NO cubre ninguna ventana, dentro de la rejilla. */
export function complementWindows(windows: MinuteWindow[], bounds: MinuteWindow): MinuteWindow[] {
  const out: MinuteWindow[] = [];
  let cursor = bounds.start;
  for (const w of mergeWindows(windows)) {
    const start = Math.max(bounds.start, w.start);
    const end = Math.min(bounds.end, w.end);
    if (end <= cursor) continue;
    if (start > cursor) out.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < bounds.end) out.push({ start: cursor, end: bounds.end });
  return out;
}

/**
 * Semana: lo que se raya de un día es lo que NINGÚN barbero visible trabaja.
 * Si alguno no tiene horario cargado todavía, a él se le puede agendar a
 * cualquier hora (mismo matiz que checkAppointmentSlot) y no se raya nada.
 */
export function weekClosedBands(
  schedules: ScheduleLike[],
  barberIds: string[],
  weekday: number,
  bounds: MinuteWindow,
): MinuteWindow[] {
  if (barberIds.length === 0) return [];
  const windows: MinuteWindow[] = [];
  for (const id of barberIds) {
    if (!hasAnySchedule(schedules, id)) return [];
    windows.push(...barberDayWindows(schedules, id, weekday));
  }
  return complementWindows(windows, bounds);
}

/**
 * «1:30» — etiqueta de MEDIA hora en la regleta: reloj de 12 h como el resto
 * de la agenda («1 p. m.» arriba), sin sufijo porque la hora en punto de
 * encima ya lo dice y no cabe en los 58 px de la regleta.
 */
export function halfHourLabel(minute: number): string {
  const m = Math.max(0, Math.round(minute));
  const h24 = Math.floor(m / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")}`;
}

/** Marcas de la regleta: horas en punto y, si caben, las medias horas. */
export function rulerMarks(
  bounds: MinuteWindow,
  pxPerMin: number,
): { minute: number; kind: "hour" | "half" }[] {
  const out: { minute: number; kind: "hour" | "half" }[] = [];
  // Una etiqueta de media hora necesita ~50 px de aire para no pegarse a la
  // de la hora: en Día (2 px/min = 60 px) cabe; en Semana (1.1 = 33) no.
  const halves = 30 * pxPerMin >= 50;
  for (let m = bounds.start; m <= bounds.end; m += 30) {
    const hour = m % 60 === 0;
    if (hour || halves) out.push({ minute: m, kind: hour ? "hour" : "half" });
  }
  return out;
}

// ── Acciones rápidas del resumen al pasar el mouse ─────────────────────

/** El flujo lineal: lo que cuenta como «seguir adelante». */
const FORWARD: BarberAppointmentStatus[] = ["CONFIRMED", "IN_PROGRESS", "DONE"];

/**
 * Qué se ofrece en el resumen de una visita: el SIGUIENTE estado del flujo
 * (si quien mira puede darlo) y cobrar. Misma regla que el detalle:
 *  · quien edita la agenda avanza cualquier visita;
 *  · el rol Barbero (ownBarberId) solo «En silla» y «Completada», y solo en
 *    SUS visitas (isOwnVisitStatus, la misma de la ruta de estado);
 *  · cobrar pide caja (canCharge) y una visita completada sin ticket.
 * Cancelar y «no llegó» NO van aquí: son decisiones, viven en el detalle.
 */
export function quickActions(args: {
  status: BarberAppointmentStatus;
  barberId: string | null;
  canEdit: boolean;
  ownBarberId: string | null;
  canCharge: boolean;
  charged: boolean;
}): { advance: BarberAppointmentStatus | null; charge: boolean; chargeOnDone: boolean } {
  const own = Boolean(args.ownBarberId) && args.barberId === args.ownBarberId;
  const allowed = (s: BarberAppointmentStatus) => args.canEdit || (own && isOwnVisitStatus(s));
  const advance =
    nextStatuses(args.status).find(
      (s) => FORWARD.includes(s) && canTransition(args.status, s) && allowed(s),
    ) ?? null;
  const chargeable =
    args.canCharge && !args.charged && args.status !== "CANCELLED" && args.status !== "NO_SHOW";
  return {
    advance,
    charge: chargeable && isTerminalAppointmentStatus(args.status),
    chargeOnDone: chargeable && advance === "DONE",
  };
}
