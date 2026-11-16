// ═══════════════════════════════════════════════════════════════════════
// ¿QUIÉN TRABAJA ESE DÍA, Y A QUIÉN SE LE PROPONE EL CLIENTE?
//
// «¿Con quién?» (Fila: anotar y sentar; Agenda: Nueva visita) listaba a
// TODO el equipo, también al que hoy descansa, y proponía al primero de la
// lista aunque estuviera de descanso (el servidor rechazaba al guardar).
// Ahora (lógica L1, ronda 2):
//   · se ocultan los que ese día NO trabajan (con «ver todos» en la UI);
//   · por omisión se propone al primero que trabaja AHORA y no tiene a
//     nadie en la silla.
//
// «Trabaja ese día» = tiene horario ese día de la semana y no todo ese
// horario está tapado por bloqueos (suyos o de la barbería entera). Un
// barbero SIN horario cargado es «no se sabe»: no se oculta (la agenda
// tampoco lo restringe; Inicio ya avisa «sin horario»).
//
// Función pura (sin React ni base) para usarla igual en el navegador
// (Agenda, que ya tiene horarios/bloqueos/visitas) y en el servidor (la
// API de la fila), y para probarla sola.
// ═══════════════════════════════════════════════════════════════════════
import { barberDayWindows, hasAnySchedule, shopDateISO, shopLocalToUtc, weekdayOfISO, type ScheduleLike } from "./agenda";

export interface TimeOffLike {
  /** null = toda la barbería. */
  barberId: string | null;
  startAt: string | Date;
  endAt: string | Date;
}

export interface VisitLike {
  barberId: string | null;
  status: string;
}

export type BarberDayStatus = "works" | "off" | "unknown";

interface Span {
  start: number;
  end: number;
}

const ms = (v: string | Date) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/** Tramos (instantes UTC en ms) que el barbero trabaja ese día, ya sin los bloqueos. */
function freeSpans(
  schedules: ScheduleLike[],
  timeOff: TimeOffLike[],
  barberId: string,
  dateISO: string,
  timezone: string,
): Span[] {
  const windows = barberDayWindows(schedules, barberId, weekdayOfISO(dateISO));
  let spans: Span[] = windows.map((w) => {
    const start = shopLocalToUtc(dateISO, w.start, timezone).getTime();
    return { start, end: start + (w.end - w.start) * 60_000 };
  });
  const blocks = timeOff
    .filter((o) => o.barberId === null || o.barberId === barberId)
    .map((o) => ({ start: ms(o.startAt), end: ms(o.endAt) }));
  for (const b of blocks) {
    const next: Span[] = [];
    for (const s of spans) {
      if (b.end <= s.start || b.start >= s.end) {
        next.push(s);
        continue;
      }
      if (b.start > s.start) next.push({ start: s.start, end: b.start });
      if (b.end < s.end) next.push({ start: b.end, end: s.end });
    }
    spans = next;
  }
  return spans.filter((s) => s.end > s.start);
}

/** ¿Trabaja ese día? «unknown» = no tiene ningún horario cargado. */
export function barberDayStatus(input: {
  schedules: ScheduleLike[];
  timeOff: TimeOffLike[];
  barberId: string;
  dateISO: string;
  timezone: string;
}): BarberDayStatus {
  if (!hasAnySchedule(input.schedules, input.barberId)) return "unknown";
  return freeSpans(input.schedules, input.timeOff, input.barberId, input.dateISO, input.timezone).length > 0
    ? "works"
    : "off";
}

/** ¿Está en su horario (y sin bloqueo) en este instante? */
export function barberWorksAt(input: {
  schedules: ScheduleLike[];
  timeOff: TimeOffLike[];
  barberId: string;
  at: Date;
  timezone: string;
}): boolean {
  const day = shopDateISO(input.at, input.timezone);
  const t = input.at.getTime();
  return freeSpans(input.schedules, input.timeOff, input.barberId, day, input.timezone).some(
    (s) => s.start <= t && t < s.end,
  );
}

export interface BarberPick {
  /** Ids a mostrar en «¿Con quién?» (trabajan ese día o no tienen horario), en el orden del equipo. */
  visible: string[];
  /** Cuántos activos quedan ocultos por no trabajar ese día (para «Ver todos (N)»). */
  hidden: number;
  /** El que se propone por omisión, o null si no hay barberos activos. */
  suggested: string | null;
}

/**
 * Lista y propuesta para «¿Con quién?». `barbers` va en el orden del equipo
 * (el mismo de las columnas de la agenda) y solo cuentan los activos.
 * `visits` son las visitas de ESE día: quien tiene una «En silla» está ocupado.
 *
 * Propuesta, en este orden:
 *   1. (si `dateISO` es hoy) trabaja ahora y no tiene a nadie en la silla;
 *   2. trabaja ese día y no tiene a nadie en la silla;
 *   3. trabaja ese día;
 *   4. sin horario cargado;
 *   5. el primero activo.
 */
export function pickBarbers(input: {
  barbers: { id: string; isActive: boolean }[];
  schedules: ScheduleLike[];
  timeOff: TimeOffLike[];
  visits: VisitLike[];
  dateISO: string;
  timezone: string;
  now: Date;
}): BarberPick {
  const active = input.barbers.filter((b) => b.isActive);
  const status = new Map(
    active.map((b) => [
      b.id,
      barberDayStatus({
        schedules: input.schedules,
        timeOff: input.timeOff,
        barberId: b.id,
        dateISO: input.dateISO,
        timezone: input.timezone,
      }),
    ]),
  );
  const visible = active.filter((b) => status.get(b.id) !== "off").map((b) => b.id);
  const isToday = shopDateISO(input.now, input.timezone) === input.dateISO;
  const inChair = new Set(
    isToday
      ? input.visits.filter((v) => v.status === "IN_PROGRESS" && v.barberId).map((v) => v.barberId as string)
      : [],
  );
  const works = active.filter((b) => status.get(b.id) === "works");
  const free = works.filter((b) => !inChair.has(b.id));
  const nowFree = isToday
    ? free.filter((b) =>
        barberWorksAt({
          schedules: input.schedules,
          timeOff: input.timeOff,
          barberId: b.id,
          at: input.now,
          timezone: input.timezone,
        }),
      )
    : [];
  const suggested =
    nowFree[0]?.id ??
    free[0]?.id ??
    works[0]?.id ??
    active.find((b) => status.get(b.id) === "unknown")?.id ??
    active[0]?.id ??
    null;
  return { visible, hidden: active.length - visible.length, suggested };
}
