// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — núcleo PURO de la agenda y de la fila virtual.
//
// Este módulo es CLIENT-SAFE a propósito: no importa prisma, no lleva
// "server-only" y no toca la red. Así la MISMA aritmética (choques,
// horarios, bloqueos, posición en la fila) corre en el servidor —donde es
// el gate de verdad— y en el navegador —donde solo previsualiza el arrastre.
// Si alguna vez alguien mete prisma aquí, el bundle del cliente truena.
//
// Todo lo que huele a base de datos vive en los route handlers de
// /api/barber/{appointments,walkins,schedules}. Este archivo solo recibe
// datos planos (ISO strings y números) y devuelve datos planos.
//
// Multi-tenant: aquí NO se decide el barbershopId. Sale siempre de
// getBarberContext() en el servidor; estas funciones ya reciben las filas
// filtradas.
//
// Terminología obligatoria del vertical: cliente / barbero / barbería /
// servicio / visita (ver BARBER_TERMS en @/lib/barber/types).
// ═══════════════════════════════════════════════════════════════════════
import type {
  BarberAppointmentDTO,
  BarberAppointmentServiceDTO,
  BarberAppointmentStatus,
  BarberDTO,
  BarberScheduleDTO,
  BarberServiceDTO,
  BarberTimeOffDTO,
  BarberWalkInDTO,
  BarberWalkInStatus,
} from "@/lib/barber/types";

// ── Constantes de rejilla ──────────────────────────────────────────────

/** Granularidad de la rejilla: 15 min es el mínimo real de una barbería. */
export const BARBER_SLOT_MINUTES = 15;

/**
 * Píxeles por minuto. Manda la PROPORCIÓN: una visita de 30 min tiene que
 * verse a ojo la tercera parte de una de 90. Con 2 px/min eso son 60 px
 * contra 180 px — imposible confundirlas. Por debajo de ~1.5 las dos se
 * leen igual de "franjita" y la agenda deja de decir cuánto dura cada cosa.
 */
export const BARBER_DAY_PX_PER_MIN = 2;
export const BARBER_WEEK_PX_PER_MIN = 1.1;

/**
 * Alto mínimo de una tarjeta, en px. Es exactamente lo que mide UNA línea
 * de la tarjeta compacta (13 px de texto + 4 px de relleno + borde): por
 * debajo de esto el nombre del cliente se corta a media letra. Solo entra
 * en juego en visitas cortísimas — en la vista día, por debajo de 10 min;
 * en la de semana, por debajo de 18.
 */
export const BARBER_CARD_MIN_PX = 22;

/** Por debajo de este alto la tarjeta se pinta en UNA sola línea. */
export const BARBER_CARD_COMPACT_PX = 46;

/** Ventana por defecto de la rejilla cuando nadie tiene horario cargado. */
export const BARBER_DEFAULT_DAY_START_MIN = 9 * 60;
export const BARBER_DEFAULT_DAY_END_MIN = 21 * 60;

/** Duración mínima y máxima aceptada para una cita (minutos). */
export const BARBER_MIN_APPOINTMENT_MIN = 5;
export const BARBER_MAX_APPOINTMENT_MIN = 8 * 60;

/** Días de la semana en el criterio JS getDay(): 0 = domingo. */
export const BARBER_WEEKDAY_LABELS_ES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

export const BARBER_WEEKDAY_SHORT_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

// ── Zona horaria de la barbería ────────────────────────────────────────
// Todo lo que se guarda en BD es UTC (timestamptz). Lo que la barbería VE es
// su zona (Barbershop.timezone). BarberSchedule guarda minutos desde
// medianoche EN ESA ZONA, así que hay que traducir en los dos sentidos.

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface ShopParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = domingo (mismo criterio que Date.getDay() y BarberSchedule.dayOfWeek). */
  weekday: number;
}

/** Descompone un instante UTC en la fecha/hora que ve la barbería. */
export function shopParts(date: Date, timezone: string): ShopParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const map = new Map<string, string>();
  for (const p of fmt.formatToParts(date)) map.set(p.type, p.value);
  // Intl puede devolver "24" para la medianoche con hourCycle h23/h24.
  const rawHour = parseInt(map.get("hour") ?? "0", 10);
  return {
    year: parseInt(map.get("year") ?? "1970", 10),
    month: parseInt(map.get("month") ?? "1", 10),
    day: parseInt(map.get("day") ?? "1", 10),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: parseInt(map.get("minute") ?? "0", 10),
    weekday: WEEKDAY_INDEX[map.get("weekday") ?? "Sun"] ?? 0,
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Fecha calendario (YYYY-MM-DD) del instante en la zona de la barbería. */
export function shopDateISO(date: Date, timezone: string): string {
  const p = shopParts(date, timezone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Minutos desde medianoche del instante en la zona de la barbería. */
export function shopMinuteOfDay(date: Date, timezone: string): number {
  const p = shopParts(date, timezone);
  return p.hour * 60 + p.minute;
}

/**
 * (fecha local + minuto del día) → instante UTC. Converge en dos pasadas
 * incluso cruzando un cambio de horario de verano: la primera corrige el
 * offset nominal, la segunda el salto del propio cambio.
 */
export function shopLocalToUtc(dateISO: string, minuteOfDay: number, timezone: string): Date {
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const desired = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  let guess = desired;
  for (let i = 0; i < 2; i++) {
    const p = shopParts(new Date(guess), timezone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
    const drift = seen - desired;
    if (drift === 0) break;
    guess -= drift;
  }
  return new Date(guess);
}

/** "2026-08-24" + n días → "2026-08-27". Aritmética pura de calendario. */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Día de la semana (0 = domingo) de una fecha YYYY-MM-DD. */
export function weekdayOfISO(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Lunes de la semana que contiene a dateISO (la semana laboral empieza el lunes). */
export function startOfWeekISO(dateISO: string): string {
  const wd = weekdayOfISO(dateISO);
  const back = wd === 0 ? 6 : wd - 1;
  return addDaysISO(dateISO, -back);
}

/** Los 7 días (YYYY-MM-DD) de la semana que contiene a dateISO. */
export function weekDaysISO(dateISO: string): string[] {
  const start = startOfWeekISO(dateISO);
  return Array.from({ length: 7 }, (_, i) => addDaysISO(start, i));
}

/** ¿Es válida una fecha YYYY-MM-DD? (defensa de entrada de las APIs). */
export function isValidDateISO(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((n) => parseInt(n, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "09:30" a partir de minutos desde medianoche. */
export function minuteToHHMM(minute: number): string {
  const m = Math.max(0, Math.round(minute));
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}

/** "9:30 a. m." legible es-MX a partir de minutos desde medianoche. */
export function minuteToLabel(minute: number): string {
  const m = Math.max(0, Math.round(minute));
  const h24 = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const suffix = h24 < 12 ? "a. m." : "p. m.";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad2(mm)} ${suffix}`;
}

/**
 * "9 a. m." — etiqueta de la REGLETA de horas. Va sin minutos a propósito:
 * la regleta solo marca horas en punto, y "9:00 a. m." completo no cabe en
 * el ancho de la columna de horas (se cortaba por la izquierda y se leía
 * ":00 a. m."). Los minutos exactos viven en la tarjeta, que sí tiene sitio.
 */
export function minuteToHourLabel(minute: number): string {
  const m = Math.max(0, Math.round(minute));
  const h24 = Math.floor(m / 60) % 24;
  const suffix = h24 < 12 ? "a. m." : "p. m.";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12} ${suffix}`;
}

/** "09:30" → 570. Devuelve null si el texto no es una hora válida. */
export function hhmmToMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  const total = h * 60 + m;
  return total > 24 * 60 ? null : total;
}

// ── Ventanas de minutos (horario recurrente, turnos partidos) ───────────

export interface MinuteWindow {
  start: number;
  end: number;
}

/**
 * Une ventanas que se solapan o se tocan. Un turno partido (9–14 y 16–20)
 * queda como DOS ventanas; 9–14 y 14–20 quedan como UNA (14 es contiguo).
 */
export function mergeWindows(windows: MinuteWindow[]): MinuteWindow[] {
  const clean = windows
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const out: MinuteWindow[] = [];
  for (const w of clean) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else out.push({ start: w.start, end: w.end });
  }
  return out;
}

export interface ScheduleLike {
  barberId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
}

/** Ventanas de trabajo (ya unidas) de un barbero en un día de la semana. */
export function barberDayWindows(
  schedules: ScheduleLike[],
  barberId: string,
  dayOfWeek: number,
): MinuteWindow[] {
  return mergeWindows(
    schedules
      .filter((s) => s.isActive && s.barberId === barberId && s.dayOfWeek === dayOfWeek)
      .map((s) => ({ start: s.startMinute, end: s.endMinute })),
  );
}

/** ¿[start,end) cabe COMPLETO dentro de una sola ventana de trabajo? */
export function windowsContain(windows: MinuteWindow[], start: number, end: number): boolean {
  return windows.some((w) => w.start <= start && end <= w.end);
}

/**
 * ¿Este barbero tiene horario configurado (cualquier día)? Distingue
 * "todavía no lo configuran" (la agenda no debe estorbar) de "hoy no
 * trabaja" (la agenda sí debe estorbar).
 */
export function hasAnySchedule(schedules: ScheduleLike[], barberId: string): boolean {
  return schedules.some((s) => s.isActive && s.barberId === barberId);
}

// ── Solapes ────────────────────────────────────────────────────────────

/** Solape de dos intervalos semiabiertos [aStart,aEnd) y [bStart,bEnd). */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * ¿Esta cita ocupa la silla? Espejo EXACTO del predicado de la constraint
 * EXCLUDE `barber_appt_no_overlap` (sql/barber_agenda.sql): todo lo que NO
 * sea cancelada ni "no llegó" bloquea. Si algún día cambia el SQL, cambia
 * aquí — o la UI y la base dejan de coincidir.
 */
export function blocksAgenda(status: BarberAppointmentStatus): boolean {
  return status !== "CANCELLED" && status !== "NO_SHOW";
}

/** Estados que la constraint de la base IGNORA (documentado para la UI). */
export const BARBER_NON_BLOCKING_STATUSES: BarberAppointmentStatus[] = ["CANCELLED", "NO_SHOW"];

// ── Validación de un hueco ─────────────────────────────────────────────

export type BarberSlotIssue =
  | "INVALID_RANGE"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "NO_BARBER"
  | "OUTSIDE_SCHEDULE"
  | "TIME_OFF"
  | "OVERLAP";

export interface BarberSlotCheck {
  ok: boolean;
  issue?: BarberSlotIssue;
  /** Id de la cita o del bloqueo que estorba (para señalarlo en la UI). */
  conflictId?: string;
  /** Texto ya listo para el usuario (es-MX). */
  message?: string;
}

export interface TimeOffLike {
  id: string;
  /** null = barbería CERRADA (festivo): bloquea a todos los barberos. */
  barberId: string | null;
  startAt: string;
  endAt: string;
  reason?: string | null;
}

export interface BusyAppointmentLike {
  id: string;
  barberId: string | null;
  startAt: string;
  endAt: string;
  status: BarberAppointmentStatus;
}

export interface CheckSlotInput {
  startAt: string | Date;
  endAt: string | Date;
  barberId: string | null;
  timezone: string;
  schedules: ScheduleLike[];
  timeOff: TimeOffLike[];
  appointments: BusyAppointmentLike[];
  /** Cita que se está moviendo: se ignora a sí misma al buscar choques. */
  excludeAppointmentId?: string | null;
  /**
   * true = exige que el hueco caiga dentro del horario del barbero. La fila
   * virtual convierte walk-ins "ahora mismo", y eso puede caer fuera del
   * horario cargado sin que sea un error del operador.
   */
  requireSchedule?: boolean;
}

const SLOT_MESSAGES: Record<BarberSlotIssue, string> = {
  INVALID_RANGE: "La hora de fin debe ser posterior a la de inicio.",
  TOO_SHORT: `La visita no puede durar menos de ${BARBER_MIN_APPOINTMENT_MIN} minutos.`,
  TOO_LONG: "La visita es demasiado larga. Revisa los servicios seleccionados.",
  NO_BARBER: "Elige al barbero que va a atender esta visita.",
  OUTSIDE_SCHEDULE: "Ese horario queda fuera del horario de trabajo del barbero.",
  TIME_OFF: "Ese horario cae dentro de un bloqueo (descanso, vacaciones o día festivo).",
  OVERLAP: "Ese barbero ya tiene otra visita a esa hora.",
};

export function slotIssueMessage(issue: BarberSlotIssue): string {
  return SLOT_MESSAGES[issue] ?? "Ese horario no está disponible.";
}

/**
 * Puerta ÚNICA de "¿se puede poner una visita aquí?". La corre el servidor
 * antes de escribir (gate real) y el navegador mientras arrastras (solo
 * pinta). La red de seguridad final es la constraint EXCLUDE de Postgres:
 * aunque esta función se equivoque, la base rechaza el solape.
 */
export function checkAppointmentSlot(input: CheckSlotInput): BarberSlotCheck {
  const start = input.startAt instanceof Date ? input.startAt : new Date(input.startAt);
  const end = input.endAt instanceof Date ? input.endAt : new Date(input.endAt);
  const startMs = start.getTime();
  const endMs = end.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return fail("INVALID_RANGE");
  }
  const durationMin = (endMs - startMs) / 60000;
  if (durationMin < BARBER_MIN_APPOINTMENT_MIN) return fail("TOO_SHORT");
  if (durationMin > BARBER_MAX_APPOINTMENT_MIN) return fail("TOO_LONG");
  if (!input.barberId) return fail("NO_BARBER");

  const barberId = input.barberId;

  // 1. Bloqueos: de toda la barbería (barberId null) o de este barbero.
  for (const off of input.timeOff) {
    if (off.barberId !== null && off.barberId !== barberId) continue;
    const oStart = new Date(off.startAt).getTime();
    const oEnd = new Date(off.endAt).getTime();
    if (!Number.isFinite(oStart) || !Number.isFinite(oEnd)) continue;
    if (intervalsOverlap(startMs, endMs, oStart, oEnd)) {
      return fail("TIME_OFF", off.id);
    }
  }

  // 2. Horario recurrente del barbero (en la zona de la barbería).
  //
  // Matiz deliberado: si el barbero NO tiene NINGUNA fila de horario, la
  // barbería todavía no configuró horarios y la agenda debe funcionar igual
  // (si no, el primer día de uso no se puede agendar nada). En cuanto
  // existe aunque sea una fila, el horario manda: un día sin filas es un
  // día que ese barbero no trabaja.
  if (input.requireSchedule !== false && hasAnySchedule(input.schedules, barberId)) {
    const dateISO = shopDateISO(start, input.timezone);
    const startMin = shopMinuteOfDay(start, input.timezone);
    const endMin = startMin + durationMin;
    const windows = barberDayWindows(input.schedules, barberId, weekdayOfISO(dateISO));
    if (!windowsContain(windows, startMin, endMin)) return fail("OUTSIDE_SCHEDULE");
  }

  // 3. Otra visita del mismo barbero (mismo predicado que la constraint).
  const exclude = input.excludeAppointmentId ?? null;
  for (const appt of input.appointments) {
    if (appt.id === exclude) continue;
    if (appt.barberId !== barberId) continue;
    if (!blocksAgenda(appt.status)) continue;
    const aStart = new Date(appt.startAt).getTime();
    const aEnd = new Date(appt.endAt).getTime();
    if (!Number.isFinite(aStart) || !Number.isFinite(aEnd)) continue;
    if (intervalsOverlap(startMs, endMs, aStart, aEnd)) {
      return fail("OVERLAP", appt.id);
    }
  }

  return { ok: true };
}

function fail(issue: BarberSlotIssue, conflictId?: string): BarberSlotCheck {
  return { ok: false, issue, conflictId, message: slotIssueMessage(issue) };
}

/**
 * Detecta el rechazo de la constraint EXCLUDE de Postgres (SQLSTATE 23P01).
 * Es la ÚLTIMA palabra sobre dobles reservas: dos peticiones simultáneas
 * pueden pasar las dos el pre-chequeo en memoria, pero solo una entra.
 */
export function isBarberOverlapError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  if (e.code === "P2010") return e.meta?.code === "23P01";
  if (e.code === "23P01") return true;
  return typeof e.message === "string" && e.message.includes("barber_appt_no_overlap");
}

// ── Rejilla de la vista día / semana ───────────────────────────────────

/**
 * Ventana vertical que debe pintar la rejilla: cubre los horarios cargados
 * y CUALQUIER cita existente (una visita fuera de horario tiene que verse,
 * no desaparecer — mismo error histórico que el dental ya pagó).
 */
export function computeGridBounds(
  windows: MinuteWindow[],
  appointmentMinutes: MinuteWindow[],
): MinuteWindow {
  let start = BARBER_DEFAULT_DAY_START_MIN;
  let end = BARBER_DEFAULT_DAY_END_MIN;
  for (const w of [...windows, ...appointmentMinutes]) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
    start = Math.min(start, w.start);
    end = Math.max(end, w.end);
  }
  // Redondea a la hora y deja un respiro de media hora abajo.
  start = Math.max(0, Math.floor(start / 60) * 60);
  end = Math.min(24 * 60, Math.ceil(end / 60) * 60);
  if (end - start < 4 * 60) end = Math.min(24 * 60, start + 4 * 60);
  return { start, end };
}

/** Snap de un minuto a la rejilla (por defecto 15 min). */
export function snapMinute(minute: number, step: number = BARBER_SLOT_MINUTES): number {
  return Math.round(minute / step) * step;
}

export interface LaneItem {
  start: number;
  end: number;
}

export interface LaneAssignment {
  lane: number;
  lanes: number;
}

/**
 * Reparte tarjetas que se solapan en carriles paralelos. En la vista día no
 * hace falta (la base impide que un barbero solape), pero la vista semana
 * junta a TODOS los barberos en una columna y ahí sí se encima todo.
 */
export function assignLanes(items: LaneItem[]): LaneAssignment[] {
  const order = items
    .map((item, index) => ({ index, start: item.start, end: item.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const result: LaneAssignment[] = items.map(() => ({ lane: 0, lanes: 1 }));
  let cluster: { index: number; start: number; end: number }[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex((endAt) => endAt <= item.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[lane] = item.end;
      }
      result[item.index].lane = lane;
    }
    for (const item of cluster) result[item.index].lanes = laneEnds.length;
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of order) {
    if (item.start >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return result;
}

// ── Servicios: duración y precio ───────────────────────────────────────

export interface ServiceLike {
  id: string;
  durationMin: number;
  price: number;
  isActive?: boolean;
}

/** Suma de duraciones de los servicios elegidos (mínimo un slot). */
export function totalServiceMinutes(services: { durationMin: number }[]): number {
  const total = services.reduce((acc, s) => acc + (Number(s.durationMin) || 0), 0);
  return Math.max(BARBER_SLOT_MINUTES, total);
}

/** Suma de precios VIVOS del catálogo (lo que se congela al reservar). */
export function totalServicePrice(services: { price: number }[]): number {
  return services.reduce((acc, s) => acc + (Number(s.price) || 0), 0);
}

// ── Duración a mano ────────────────────────────────────────────────────
//
// Normalmente la duración la mandan los servicios, pero la realidad del
// mostrador no siempre cabe en el catálogo: "hoy este corte me va a llevar
// media hora más". Por eso la visita puede llevar una duración PROPIA que
// pisa la suma del catálogo. El servidor la vuelve a acotar con este mismo
// helper (punto único) y el hueco se revalida igual que al mover.

/** Escalón del control de duración: 5 min, el mínimo del contrato. */
export const BARBER_DURATION_STEP_MIN = 5;

/**
 * Acota una duración escrita a mano al rango del contrato y al escalón de
 * 5 min. Devuelve null si no es un número usable (así el caller distingue
 * "no me mandaron duración" de "me mandaron una basura").
 */
export function clampAppointmentMinutes(value: unknown): number | null {
  const raw = typeof value === "string" ? Number(value) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  // El rechazo mira la ENTRADA, no el redondeo: escribir "1" es pedir una
  // visita cortísima (se acota al mínimo de 5), no escribir basura. Si se
  // rechazara después de redondear, todo lo menor a 2.5 caería en null y el
  // campo de duración se quedaría mudo al teclear el primer dígito.
  if (raw <= 0) return null;
  const stepped = Math.round(raw / BARBER_DURATION_STEP_MIN) * BARBER_DURATION_STEP_MIN;
  return Math.min(BARBER_MAX_APPOINTMENT_MIN, Math.max(BARBER_MIN_APPOINTMENT_MIN, stepped));
}

/** Minutos que dura una visita ya guardada. */
export function appointmentMinutes(appointment: { startAt: string; endAt: string }): number {
  const ms = new Date(appointment.endAt).getTime() - new Date(appointment.startAt).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 60_000) : 0;
}

/**
 * Duración promedio de los servicios ACTIVOS de la barbería. Es la base de
 * la estimación de espera de la fila virtual. Sin catálogo activo cae a 30
 * min (el corte estándar de BARBER_DEFAULT_SERVICES).
 */
export function averageServiceMinutes(services: { durationMin: number; isActive?: boolean }[]): number {
  const active = services.filter((s) => s.isActive !== false && Number(s.durationMin) > 0);
  if (active.length === 0) return 30;
  const sum = active.reduce((acc, s) => acc + Number(s.durationMin), 0);
  return Math.max(5, Math.round(sum / active.length));
}

// ── Fila virtual ───────────────────────────────────────────────────────

/** Estados que siguen ocupando lugar en la fila. */
export const BARBER_WALKIN_ACTIVE_STATUSES: BarberWalkInStatus[] = ["WAITING", "CALLED"];

export function isActiveWalkIn(status: BarberWalkInStatus): boolean {
  return status === "WAITING" || status === "CALLED";
}

export interface WalkInLike {
  id: string;
  position: number;
  barberId: string | null;
  status: BarberWalkInStatus;
  joinedAt?: string;
}

/**
 * Fila activa en orden de llegada. `position` es un CONTADOR MONOTÓNICO por
 * barbería (nunca se recicla, nunca se renumera: renumerar con gente dentro
 * es la fuente clásica de "me brincaron"). El número que ve el cliente es el
 * RANGO dentro de esta lista, no la columna position.
 */
export function activeWalkIns<T extends WalkInLike>(rows: T[]): T[] {
  return rows
    .filter((r) => isActiveWalkIn(r.status))
    .sort((a, b) => a.position - b.position);
}

/**
 * Cuántos hay delante de esta entrada. Si el cliente pidió un barbero
 * concreto, solo le estorban los que van con ESE barbero o los que aún no
 * eligieron (podrían caerle encima); si no pidió a nadie, le estorban todos.
 */
export function walkInsAhead(rows: WalkInLike[], entryId: string): number {
  const queue = activeWalkIns(rows);
  const index = queue.findIndex((r) => r.id === entryId);
  if (index <= 0) return Math.max(0, index);
  const me = queue[index];
  const before = queue.slice(0, index);
  if (!me.barberId) return before.length;
  return before.filter((r) => r.barberId === null || r.barberId === me.barberId).length;
}

/** Rango 1-based dentro de la fila activa (0 si la entrada ya no está). */
export function walkInRank(rows: WalkInLike[], entryId: string): number {
  const index = activeWalkIns(rows).findIndex((r) => r.id === entryId);
  return index === -1 ? 0 : index + 1;
}

export interface WaitEstimateInput {
  /** Cuántas personas van delante (ver walkInsAhead). */
  ahead: number;
  /** Sillas que pueden despachar la fila (barberos activos, mínimo 1). */
  chairs: number;
  /** Duración promedio de los servicios de la barbería. */
  avgServiceMin: number;
}

/**
 * Espera estimada en minutos: `promedio × delante / sillas`, redondeado a
 * bloques de 5. Es a propósito una cuenta que el dueño puede explicarle al
 * cliente en voz alta. `ahead = 0` devuelve 0 → la UI dice "eres el
 * siguiente", que es más honesto que inventar minutos.
 */
export function estimateWaitMinutes(input: WaitEstimateInput): number {
  const chairs = Math.max(1, Math.floor(input.chairs) || 1);
  const ahead = Math.max(0, Math.floor(input.ahead) || 0);
  const avg = Math.max(5, Math.round(input.avgServiceMin) || 30);
  if (ahead === 0) return 0;
  const raw = (avg * ahead) / chairs;
  return Math.max(5, Math.round(raw / 5) * 5);
}

/** Duración pelona: "0 min" / "25 min" / "1 h 10 min". No interpreta nada. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes) || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/**
 * Espera para el mostrador: cero minutos no es "0 min", es "ya casi". La
 * página pública tiene su propio texto para ese caso (viene del
 * diccionario, porque ahí sí hay que traducirlo).
 */
export function formatWaitMinutes(minutes: number): string {
  return minutes <= 0 ? "Ya casi" : formatMinutes(minutes);
}

// ── Recordatorios: el bug M-22 del dental que NO se repite aquí ─────────
//
// En el dental, reagendar una cita NO cancela el recordatorio ya programado
// y al cliente le llega el aviso de la hora vieja. Aquí, mover o cancelar
// una cita INVALIDA sus recordatorios pendientes: la fila OUTBOUND en
// estado PENDING ligada a esa cita pasa a FAILED con una marca canónica.
// La ola de WhatsApp (T7) reprograma desde cero leyendo la cita ya movida y
// NUNCA debe tomar como pendiente una fila marcada así.

/** Marca canónica en BarberMessage.errorMessage. T7 la reconoce por prefijo. */
export const BARBER_REMINDER_INVALIDATED_MARK = "[recordatorio-invalidado]";

export type BarberReminderInvalidationCause =
  | "MOVED"
  | "CANCELLED"
  | "NO_SHOW"
  | "SERVICES_CHANGED"
  | "COMPLETED";

const REMINDER_CAUSE_TEXT: Record<BarberReminderInvalidationCause, string> = {
  MOVED: "la visita se movió de horario o de barbero",
  CANCELLED: "la visita se canceló",
  NO_SHOW: "la visita se marcó como no llegó",
  SERVICES_CHANGED: "cambiaron los servicios y con ellos la duración",
  COMPLETED: "la visita ya se completó",
};

/**
 * WHERE de los recordatorios que hay que invalidar. Objeto plano (sin
 * prisma) para que este módulo siga siendo client-safe; encaja tal cual en
 * prisma.barberMessage.updateMany({ where: ... }).
 *
 * OJO tenant: barbershopId va SIEMPRE, y sale de getBarberContext(). En
 * Prisma un undefined aquí BORRARÍA el filtro y tocaría otras barberías.
 */
export function pendingReminderInvalidationWhere(barbershopId: string, appointmentId: string) {
  return {
    barbershopId,
    appointmentId,
    direction: "OUTBOUND" as const,
    status: "PENDING" as const,
  };
}

/** DATA del updateMany que invalida (marca, no borra: deja rastro). */
export function reminderInvalidationData(cause: BarberReminderInvalidationCause) {
  return {
    status: "FAILED" as const,
    errorMessage: `${BARBER_REMINDER_INVALIDATED_MARK} ${REMINDER_CAUSE_TEXT[cause]}`,
  };
}

/** ¿Esta fila fallida es un recordatorio que invalidamos nosotros? */
export function isInvalidatedReminder(errorMessage: string | null | undefined): boolean {
  return typeof errorMessage === "string" && errorMessage.startsWith(BARBER_REMINDER_INVALIDATED_MARK);
}

// ── Punto de extensión: aviso de la fila por WhatsApp (lo conecta T7) ───
//
// Esta ola NO envía nada. Cuando el mostrador toca "Avisar", se ENCOLA una
// fila BarberMessage OUTBOUND / PENDING con este templateName y el cuerpo ya
// redactado. T7 lee las PENDING, las manda por la WABA de la barbería y les
// pone SENT (o FAILED con su propio motivo). Ese es todo el contrato: no hay
// tabla nueva ni cola aparte.

export const BARBER_WALKIN_NOTIFY_TEMPLATE = "walkin_casi_es_tu_turno" as const;

export interface WalkInNotifyInput {
  shopName: string;
  clientName: string;
  ahead: number;
  etaMinutes: number;
}

/** Cuerpo del aviso de fila. Texto único: lo comparten panel y T7. */
export function walkInNotifyBody(input: WalkInNotifyInput): string {
  const first = input.clientName.trim().split(/\s+/)[0] || "Hola";
  if (input.ahead <= 0) {
    return `${first}, ya es tu turno en ${input.shopName}. Te esperamos en la silla.`;
  }
  const people = input.ahead === 1 ? "1 persona" : `${input.ahead} personas`;
  return (
    `${first}, faltan ${people} para tu turno en ${input.shopName}. ` +
    `Vente en unos ${input.etaMinutes} min.`
  );
}

// ── Mapeadores a DTO ───────────────────────────────────────────────────
// Reciben filas de Prisma pero SIN importar prisma: los Decimal entran como
// "algo que sabe volverse número" y los DateTime como Date.

type Decimalish = { toString(): string } | number | string | null | undefined;

function num(value: Decimalish): number {
  if (value === null || value === undefined) return 0;
  const n = Number(typeof value === "object" ? value.toString() : value);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: Decimalish): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(typeof value === "object" ? value.toString() : value);
  return Number.isFinite(n) ? n : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toBarberDTO(row: {
  id: string;
  name: string;
  nickname: string | null;
  photoUrl: string | null;
  bio: string | null;
  commissionType: BarberDTO["commissionType"];
  commissionPct: Decimalish;
  chairRent: Decimalish;
  isActive: boolean;
  sortOrder: number;
}): BarberDTO {
  return {
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    photoUrl: row.photoUrl,
    bio: row.bio,
    commissionType: row.commissionType,
    commissionPct: numOrNull(row.commissionPct),
    chairRent: numOrNull(row.chairRent),
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

export function toServiceDTO(row: {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  price: Decimalish;
  category: string;
  isActive: boolean;
  sortOrder: number;
}): BarberServiceDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    durationMin: row.durationMin,
    price: num(row.price),
    category: row.category,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

export function toAppointmentDTO(row: {
  id: string;
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  barberId: string | null;
  startAt: Date | string;
  endAt: Date | string;
  status: BarberAppointmentStatus;
  source: BarberAppointmentDTO["source"];
  depositAmount: Decimalish;
  depositStatus: BarberAppointmentDTO["depositStatus"];
  notes: string | null;
  client?: { name: string; phone: string } | null;
  barber?: { name: string; nickname: string | null } | null;
  services?: {
    id: string;
    serviceId: string;
    priceAtBooking: Decimalish;
    service?: { name: string } | null;
  }[];
}): BarberAppointmentDTO {
  const services: BarberAppointmentServiceDTO[] = (row.services ?? []).map((s) => ({
    id: s.id,
    serviceId: s.serviceId,
    serviceName: s.service?.name ?? "Servicio",
    priceAtBooking: num(s.priceAtBooking),
  }));
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client?.name ?? row.clientName,
    clientPhone: row.client?.phone ?? row.clientPhone,
    barberId: row.barberId,
    barberName: row.barber ? row.barber.nickname || row.barber.name : null,
    startAt: iso(row.startAt) ?? new Date().toISOString(),
    endAt: iso(row.endAt) ?? new Date().toISOString(),
    status: row.status,
    source: row.source,
    depositAmount: numOrNull(row.depositAmount),
    depositStatus: row.depositStatus,
    notes: row.notes,
    services,
  };
}

export function toWalkInDTO(row: {
  id: string;
  clientName: string;
  phone: string | null;
  barberId: string | null;
  joinedAt: Date | string;
  calledAt: Date | string | null;
  servedAt: Date | string | null;
  status: BarberWalkInStatus;
  position: number;
}): BarberWalkInDTO {
  return {
    id: row.id,
    clientName: row.clientName,
    phone: row.phone,
    barberId: row.barberId,
    joinedAt: iso(row.joinedAt) ?? new Date().toISOString(),
    calledAt: iso(row.calledAt),
    servedAt: iso(row.servedAt),
    status: row.status,
    position: row.position,
  };
}

export function toScheduleDTO(row: {
  id: string;
  barberId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
}): BarberScheduleDTO {
  return {
    id: row.id,
    barberId: row.barberId,
    dayOfWeek: row.dayOfWeek,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    isActive: row.isActive,
  };
}

export function toTimeOffDTO(row: {
  id: string;
  barberId: string | null;
  startAt: Date | string;
  endAt: Date | string;
  reason: string | null;
  type: BarberTimeOffDTO["type"];
  createdByUserId: string;
}): BarberTimeOffDTO {
  return {
    id: row.id,
    barberId: row.barberId,
    startAt: iso(row.startAt) ?? new Date().toISOString(),
    endAt: iso(row.endAt) ?? new Date().toISOString(),
    reason: row.reason,
    type: row.type,
    createdByUserId: row.createdByUserId,
  };
}

// ── Formato de dinero (es-MX) ──────────────────────────────────────────
const MXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatMXN(value: number): string {
  return MXN.format(Number.isFinite(value) ? value : 0);
}
