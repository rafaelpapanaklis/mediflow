/**
 * DaleControl INSTITUCIONAL — el cerebro de la AGENDA, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin `new Date()`
 * escondido: el `now` siempre se pasa o se toma en UN solo lugar visible).
 * Aquí viven las decisiones que, si se escriben dos veces, terminan
 * discrepando:
 *
 *   1. LA HORA        · pared del instituto ⇄ instante (Timestamptz)
 *   2. EL RANGO       · qué es "el día" y qué es "la semana"
 *   3. EL CHOQUE      · dos citas no caben en el mismo sillón a la vez
 *   4. EL HORARIO     · el sillón abre a las 8 (y sin filas, siempre)
 *   5. EL ESTADO      · llegó → se sentó → se le trabaja → terminó
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA HORA, Y POR QUÉ NO SE GUARDA COMO TEXTO
 *
 * Una cita es un INSTANTE: la columna es Timestamptz. Un horario de sillón
 * es una hora de PARED: "el sillón 3 abre a las 8" no cambia porque cambie
 * el horario de verano, y por eso se guarda como minutos desde la
 * medianoche (480 = 08:00) y no como instante.
 *
 * La conversión entre las dos vive AQUÍ y en ningún otro lado, y usa
 * EduInstitution.timezone. Ni el navegador ni el servidor usan su propia
 * zona: si el servidor corre en UTC (Vercel) y la escuela está en
 * Guadalajara, "las 8" tienen que seguir siendo las 8 de Guadalajara.
 *
 * Las etiquetas ("08:30", "lun 31 ago") se calculan en el SERVIDOR y viajan
 * ya formateadas. Formatearlas en el cliente con la zona del dispositivo
 * daría una hora distinta a la del servidor en el primer render y React
 * marcaría el desajuste de hidratación — además de mentirle a un alumno que
 * viaja con el teléfono en otra zona.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type {
  EduAppointmentStatus,
  EduAppointmentType,
  EduCaseStatus,
} from "@/lib/edu/types";
import {
  EDU_APPOINTMENT_FREE_STATUSES,
  EDU_APPOINTMENT_STATUSES,
  EDU_APPOINTMENT_TYPES,
  EDU_CASE_STATUSES,
} from "@/lib/edu/types";

// ═══════════════════════════════════════════════════════════════════════
// 0 · TECHOS Y CONSTANTES
// ═══════════════════════════════════════════════════════════════════════

/** Techo de filas por consulta de agenda. Una semana de una escuela son
 *  cientos de citas, no miles; el tope está para que una consulta rota no
 *  se traiga la tabla entera. */
export const EDU_AGENDA_MAX_ROWS = 500;

/** Techo de filas del listado de pacientes y de casos. */
export const EDU_CLINICA_MAX_ROWS = 300;

/** Duración de una cita, en minutos. */
export const EDU_APPOINTMENT_MIN_MINUTES = 10;
export const EDU_APPOINTMENT_MAX_MINUTES = 8 * 60;
export const EDU_APPOINTMENT_DEFAULT_MINUTES = 60;

/** Cuántos sillones puede dar de alta una escuela. Alto pero finito. */
export const EDU_MAX_CHAIRS = 200;
/** El número pintado en la pared: de 1 a 999. */
export const EDU_MAX_CHAIR_NUMBER = 999;

/** Minutos en un día. Un horario que llegue a 1440 es "hasta medianoche". */
export const EDU_MINUTES_IN_DAY = 24 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════
// 1 · DÍAS DE LA SEMANA
//     0 = domingo … 6 = sábado, igual que Date#getUTCDay, para no tener
//     que traducir en ningún lado. Lo que SÍ se traduce es cómo se pintan:
//     la semana de la escuela empieza en lunes.
// ═══════════════════════════════════════════════════════════════════════

export const EDU_WEEKDAY_LABELS: string[] = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

export const EDU_WEEKDAY_SHORT: string[] = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** El orden en que se pintan los días: la semana laboral primero. */
export const EDU_WEEK_ORDER: number[] = [1, 2, 3, 4, 5, 6, 0];

// ═══════════════════════════════════════════════════════════════════════
// 2 · HORA DEL DÍA ⇄ MINUTOS
// ═══════════════════════════════════════════════════════════════════════

/** 510 → "08:30". Con cero a la izquierda: "8:30" se lee mal en una lista. */
export function eduMinutesToLabel(minutes: number): string {
  const m = Math.max(0, Math.min(EDU_MINUTES_IN_DAY, Math.trunc(minutes)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * "08:30" (o 510) → 510. `null` si no sirve.
 *
 * Acepta el número porque un <input type="time"> manda texto y una API
 * puede mandar el entero; rechazar uno de los dos obligaría a cada quien a
 * convertir por su cuenta, que es como se cuelan las conversiones distintas.
 */
export function parseEduMinuteOfDay(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return null;
    return raw >= 0 && raw <= EDU_MINUTES_IN_DAY ? raw : null;
  }
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) return null;
  const total = h * 60 + mi;
  return total <= EDU_MINUTES_IN_DAY ? total : null;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · FECHA DE CALENDARIO (AAAA-MM-DD)
// ═══════════════════════════════════════════════════════════════════════

/** Un "AAAA-MM-DD" de verdad, o null. Rebota el 31 de febrero. */
export function parseEduDayISO(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** El día siguiente / anterior, sin tocar zonas horarias: es aritmética de
 *  calendario, no de instantes. */
export function eduShiftDayISO(dayISO: string, days: number): string {
  const parsed = parseEduDayISO(dayISO);
  if (!parsed) return dayISO;
  const [y, m, d] = parsed.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return next.toISOString().slice(0, 10);
}

/** 0=domingo … 6=sábado del día de calendario (sin zonas: el 31 de agosto
 *  de 2026 es lunes en todas partes). */
export function eduWeekdayOf(dayISO: string): number {
  const parsed = parseEduDayISO(dayISO);
  if (!parsed) return 0;
  const [y, m, d] = parsed.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** El lunes de la semana de ese día. */
export function eduWeekStartISO(dayISO: string): string {
  const wd = eduWeekdayOf(dayISO);
  // domingo (0) pertenece a la semana que EMPEZÓ el lunes anterior: se
  // retrocede 6, no 0. Si no, el domingo se pintaría como el arranque de la
  // semana que viene y la agenda se partiría en dos justo el fin de semana.
  const back = wd === 0 ? 6 : wd - 1;
  return eduShiftDayISO(dayISO, -back);
}

/** Los siete días de la semana de ese día, de lunes a domingo. */
export function eduWeekDays(dayISO: string): string[] {
  const start = eduWeekStartISO(dayISO);
  return Array.from({ length: 7 }, (_, i) => eduShiftDayISO(start, i));
}

/** "lun 31 ago". Corto porque va en el encabezado de una columna. */
export function eduFormatDayShort(dayISO: string): string {
  const parsed = parseEduDayISO(dayISO);
  if (!parsed) return "—";
  const [y, m, d] = parsed.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
    // 🔴 UTC a propósito: es una fecha de CALENDARIO construida a
    // medianoche UTC. Pintarla en la zona local le restaría horas y el 31
    // saldría "30" en México — el mismo error que ya se pagó en el
    // calendario del dental.
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "lunes 31 de agosto de 2026". Para el encabezado de la vista de día. */
export function eduFormatDayLong(dayISO: string): string {
  const parsed = parseEduDayISO(dayISO);
  if (!parsed) return "—";
  const [y, m, d] = parsed.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · ZONA HORARIA DEL INSTITUTO
//
// Sin biblioteca de fechas: `Intl.DateTimeFormat` con `timeZone` ya sabe
// de horarios de verano y viene en Node y en el navegador. Meter una
// dependencia nueva al vertical por esto no se justifica.
// ═══════════════════════════════════════════════════════════════════════

/** La zona a usar. Una zona ilegible cae a UTC en vez de reventar: una
 *  agenda desplazada se ve y se arregla; una pantalla en blanco, no. */
export function eduSafeTimeZone(timeZone: string | null | undefined): string {
  const tz = (timeZone ?? "").trim();
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return "UTC";
  }
}

const PARTS_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = PARTS_FORMAT_CACHE.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PARTS_FORMAT_CACHE.set(timeZone, f);
  }
  return f;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  // Algunos ICU devuelven "24" para la medianoche con hour12:false. Sin
  // esta línea, la medianoche del instituto se leería como las 24:00 del
  // día anterior y el día entero se correría.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Cuánto adelanta (o atrasa) esa zona respecto de UTC EN ESE INSTANTE. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

/**
 * Hora de PARED del instituto → INSTANTE.
 *
 * Se resuelve en dos pasadas a propósito: la primera usa el desfase del
 * instante "ingenuo" y la segunda lo corrige con el desfase del resultado.
 * Sin la segunda, una cita de las 8 de la mañana del día en que entra el
 * horario de verano quedaría una hora movida.
 *
 * ⚠️ La hora que NO EXISTE (el salto de primavera) cae en la siguiente que
 * sí existe, y la hora REPETIDA (el salto de otoño) cae en la primera de
 * las dos. México ya no cambia de horario, pero el producto es genérico y
 * un instituto puede estar en una zona que sí.
 */
export function eduZonedToUtc(dayISO: string, minuteOfDay: number, timeZone: string): Date | null {
  const parsed = parseEduDayISO(dayISO);
  if (!parsed) return null;
  if (!Number.isFinite(minuteOfDay)) return null;
  const tz = eduSafeTimeZone(timeZone);
  const [y, m, d] = parsed.split("-").map(Number);

  const naive = Date.UTC(y, m - 1, d) + Math.trunc(minuteOfDay) * 60_000;
  let ts = naive - offsetMs(new Date(naive), tz);
  ts = naive - offsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** INSTANTE → día de calendario y minuto del día EN EL INSTITUTO. */
export function eduUtcToZoned(
  instant: Date,
  timeZone: string,
): { dayISO: string; minuteOfDay: number; weekday: number } {
  const tz = eduSafeTimeZone(timeZone);
  const p = zonedParts(instant, tz);
  const dayISO = `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return {
    dayISO,
    minuteOfDay: p.hour * 60 + p.minute,
    weekday: eduWeekdayOf(dayISO),
  };
}

/** "08:30" en la hora del instituto. */
export function eduFormatTime(instant: Date, timeZone: string): string {
  return eduMinutesToLabel(eduUtcToZoned(instant, timeZone).minuteOfDay);
}

/** Hoy, en el calendario del instituto (no en el del servidor). */
export function eduTodayISO(timeZone: string, now: Date = new Date()): string {
  return eduUtcToZoned(now, timeZone).dayISO;
}

/**
 * El rango [desde, hasta) que cubre esos días de calendario en la zona del
 * instituto. Medianoche a medianoche, en instantes.
 *
 * 🔴 El extremo derecho es EXCLUSIVO. Con `lte` a la medianoche siguiente,
 * una cita que empieza justo a las 00:00 saldría en los dos días.
 */
export function eduDayRange(
  dayISO: string,
  timeZone: string,
  days = 1,
): { from: Date; to: Date } | null {
  const from = eduZonedToUtc(dayISO, 0, timeZone);
  if (!from) return null;
  const to = eduZonedToUtc(eduShiftDayISO(dayISO, Math.max(1, days)), 0, timeZone);
  if (!to) return null;
  return { from, to };
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL CHOQUE DE HORARIOS
// ═══════════════════════════════════════════════════════════════════════

/**
 * ¿Se pisan dos intervalos? Medio abiertos: [aInicio, aFin) y [bInicio, bFin).
 *
 * Que sea medio abierto es la diferencia entre "la de las 9 a las 10 y la
 * de las 10 a las 11 chocan" (falso, y es lo correcto: una empieza cuando
 * la otra acaba) y una agenda en la que no cabe nada seguido.
 */
export function eduOverlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** ¿Este estado libera el sillón? Cancelada y "no llegó" sí; terminada no
 *  (ocurrió, y su hueco estuvo ocupado). */
export function eduStatusFreesChair(status: EduAppointmentStatus): boolean {
  return EDU_APPOINTMENT_FREE_STATUSES.includes(status);
}

/** Los estados que SÍ ocupan el sillón. Es lo que va en el `where` del
 *  choque: escribirlo dos veces es cómo una consulta acaba contando las
 *  canceladas y la otra no. */
export const EDU_BUSY_STATUSES: EduAppointmentStatus[] = EDU_APPOINTMENT_STATUSES.filter(
  (s) => !EDU_APPOINTMENT_FREE_STATUSES.includes(s),
);

// ═══════════════════════════════════════════════════════════════════════
// 6 · EL HORARIO DEL SILLÓN
// ═══════════════════════════════════════════════════════════════════════

export interface EduScheduleSlot {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/**
 * ¿Cabe esta cita en el horario del sillón?
 *
 * 🔴 SIN FILAS = SIEMPRE ABIERTO. Un sillón recién dado de alta acepta
 * cualquier hora; en cuanto tiene UNA franja, solo acepta lo que cae
 * dentro. La asimetría es a propósito: obligar a capturar un horario antes
 * de poder agendar convertiría el alta de un sillón en un trámite, y una
 * escuela que todavía no lo capturó no puede quedarse sin agenda.
 *
 * La cita tiene que caber ENTERA en UNA franja. Si el sillón abre 8–12 y
 * 16–20, una cita de 11:30 a 12:30 no cabe: la mitad cae en el hueco de la
 * comida. Partirla entre dos franjas sería inventar que la clínica está
 * abierta cuando no lo está.
 */
export function eduScheduleAllows(
  slots: EduScheduleSlot[],
  weekday: number,
  startMinute: number,
  endMinute: number,
): boolean {
  const delDia = (slots ?? []).filter((s) => s.weekday === weekday);
  // Ojo: si el sillón tiene horario pero NINGUNA franja ese día, está
  // cerrado ese día. Es distinto de "no tiene horario".
  if ((slots ?? []).length === 0) return true;
  if (delDia.length === 0) return false;
  return delDia.some((s) => startMinute >= s.startMinute && endMinute <= s.endMinute);
}

/** Cómo se lee el horario de un sillón en la pantalla: "Lun, Mié 08:00–14:00". */
export function eduDescribeSchedule(slots: EduScheduleSlot[]): string {
  if (!slots || slots.length === 0) return "Sin horario: acepta cualquier hora";
  const porFranja = new Map<string, number[]>();
  for (const s of slots) {
    const key = `${s.startMinute}-${s.endMinute}`;
    const dias = porFranja.get(key) ?? [];
    dias.push(s.weekday);
    porFranja.set(key, dias);
  }
  return Array.from(porFranja.entries())
    .map(([key, dias]) => {
      const [ini, fin] = key.split("-").map(Number);
      const nombres = EDU_WEEK_ORDER.filter((d) => dias.includes(d)).map((d) => EDU_WEEKDAY_SHORT[d]);
      return `${nombres.join(", ")} ${eduMinutesToLabel(ini)}–${eduMinutesToLabel(fin)}`;
    })
    .join(" · ");
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · EL ESTADO DE LA CITA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Qué se puede hacer desde dónde.
 *
 * Los tres estados finales (terminada, cancelada, no llegó) NO tienen
 * salida: una cita terminada no se reabre, se agenda otra. Si se pudiera
 * volver atrás, el `completedAt` dejaría de significar algo.
 *
 * SCHEDULED → IN_CHAIR sin pasar por CHECKED_IN existe porque pasa: el
 * paciente llega y el alumno lo sienta de una vez. El producto no le va a
 * exigir dos toques a alguien que tiene las manos ocupadas.
 */
export const EDU_APPOINTMENT_TRANSITIONS: Record<EduAppointmentStatus, EduAppointmentStatus[]> = {
  SCHEDULED: ["CHECKED_IN", "IN_CHAIR", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["IN_CHAIR", "IN_PROGRESS", "CANCELLED", "NO_SHOW"],
  IN_CHAIR: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function eduAppointmentCanTransition(
  from: EduAppointmentStatus,
  to: EduAppointmentStatus,
): boolean {
  if (from === to) return false;
  return (EDU_APPOINTMENT_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Los estados que registran LO QUE ESTÁ PASANDO en el sillón. Los puede
 * mover quien ve la cita (alumno, docente, caja, dirección) con
 * "agenda.view" — no es administrar la agenda, es apuntar que el paciente
 * ya se sentó.
 *
 * 🔴 Ésta es la razón de que /mi-dia sirva de algo: un ALUMNO solo trae
 * agenda.view por defecto, y sin esta distinción no podría marcar nada de
 * su propio día. El recorte lo pone la VISIBILIDAD: solo sus citas.
 */
export const EDU_APPOINTMENT_CLINICAL_STATUSES: EduAppointmentStatus[] = [
  "CHECKED_IN",
  "IN_CHAIR",
  "IN_PROGRESS",
  "COMPLETED",
];

/**
 * Los estados que son una DECISIÓN administrativa: cancelar y dar por no
 * presentado. Exigen "agenda.manage" — tienen consecuencias (el hueco se
 * libera, y en la Ola 5, el cobro).
 */
export const EDU_APPOINTMENT_ADMIN_STATUSES: EduAppointmentStatus[] = ["CANCELLED", "NO_SHOW"];

/** ¿Mover a este estado exige agenda.manage? */
export function eduStatusNeedsManage(status: EduAppointmentStatus): boolean {
  return EDU_APPOINTMENT_ADMIN_STATUSES.includes(status);
}

/**
 * Las marcas de tiempo que hay que escribir al llegar a un estado.
 *
 * Se DERIVAN del estado y no se capturan: así no puede existir una cita
 * "terminada" sin hora de fin, ni una hora de fin en una que sigue
 * agendada. Lo ya escrito no se pisa (`?? now` solo rellena lo vacío):
 * quien llegó a las 9:02 llegó a las 9:02 aunque después alguien vuelva a
 * tocar la fila.
 */
export function eduAppointmentStamps(
  status: EduAppointmentStatus,
  current: { checkedInAt: Date | null; startedAt: Date | null; completedAt: Date | null },
  now: Date,
): { checkedInAt?: Date; startedAt?: Date; completedAt?: Date } {
  const out: { checkedInAt?: Date; startedAt?: Date; completedAt?: Date } = {};
  if (status === "CHECKED_IN") {
    if (!current.checkedInAt) out.checkedInAt = now;
  }
  if (status === "IN_CHAIR") {
    if (!current.checkedInAt) out.checkedInAt = now;
    if (!current.startedAt) out.startedAt = now;
  }
  if (status === "IN_PROGRESS") {
    if (!current.checkedInAt) out.checkedInAt = now;
    if (!current.startedAt) out.startedAt = now;
  }
  if (status === "COMPLETED") {
    if (!current.startedAt) out.startedAt = now;
    if (!current.completedAt) out.completedAt = now;
  }
  return out;
}

/**
 * 🔴 UNA CITA Y SU CASO SON DEL MISMO PACIENTE Y DEL MISMO ALUMNO.
 *
 * La invariante que el POST de la agenda ya defendía y que el PATCH se
 * saltaba (P1-3 de la auditoría): reagendar cambiaba el `studentId` de la
 * cita y dejaba el `caseId` del alumno ANTERIOR. La fila quedaba diciendo
 * que B atendió el caso de A — con eso, las horas clínicas se cuentan por
 * un lado, el caso pertenece a otro, y la etapa SESSION del gate de la Ola
 * 4 firmaría una sesión que nadie dio.
 *
 * Vive aquí, en lo puro, para que la comprueben LAS DOS escrituras con la
 * misma línea: dos copias de una regla son dos sitios donde discrepar.
 *
 * Un caso ausente (`null`) devuelve `false` a propósito: quien pregunta
 * está decidiendo si ENGANCHA algo, y "no hay caso" no es "encaja".
 */
export function eduCaseFitsAppointment(
  caso: { patientId: string; studentId: string } | null | undefined,
  cita: { patientId: string; studentId: string },
): boolean {
  if (typeof caso !== "object" || caso === null) return false;
  if (typeof cita !== "object" || cita === null) return false;
  return caso.patientId === cita.patientId && caso.studentId === cita.studentId;
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · SANEO DE LO QUE ENTRA POR UN ENDPOINT
// ═══════════════════════════════════════════════════════════════════════

export function parseEduAppointmentType(raw: unknown): EduAppointmentType | null {
  if (typeof raw !== "string") return null;
  return (EDU_APPOINTMENT_TYPES as string[]).includes(raw) ? (raw as EduAppointmentType) : null;
}

export function parseEduAppointmentStatus(raw: unknown): EduAppointmentStatus | null {
  if (typeof raw !== "string") return null;
  return (EDU_APPOINTMENT_STATUSES as string[]).includes(raw)
    ? (raw as EduAppointmentStatus)
    : null;
}

export function parseEduCaseStatus(raw: unknown): EduCaseStatus | null {
  if (typeof raw !== "string") return null;
  return (EDU_CASE_STATUSES as string[]).includes(raw) ? (raw as EduCaseStatus) : null;
}

/** Duración en minutos, dentro de los topes. */
export function parseEduDurationMinutes(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < EDU_APPOINTMENT_MIN_MINUTES || n > EDU_APPOINTMENT_MAX_MINUTES) return null;
  return n;
}

/** Un id que viene del cliente: recortado, con techo y sin caracteres
 *  raros. Nunca se confía en él para el tenant — eso lo cierra el `where`. */
export function eduCleanId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 40) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

/** Texto opcional (notas). "" y "   " significan BORRAR, no "no cambies". */
export function eduOptionalText(raw: unknown, maxLength: number): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (v.length === 0) return null;
  return v.slice(0, maxLength);
}

// ═══════════════════════════════════════════════════════════════════════
// 8b · LO QUE SE LEE DE LA URL
//
// Los filtros de la agenda viajan en la query string y no en un useState:
// así se pueden compartir ("mira el jueves del sillón 3"), sobreviven a un
// refresh y el filtrado ocurre en la BASE — filtrar en memoria mentiría en
// cuanto la semana pase del techo de filas.
// ═══════════════════════════════════════════════════════════════════════

export type EduAgendaView = "dia" | "semana";

export interface EduAgendaQuery {
  view: EduAgendaView;
  /** El día que se está viendo (en el calendario del INSTITUTO). */
  dayISO: string;
  chairId: string | null;
  /** La especialidad. Filtra por el programa DEL ALUMNO que atiende. */
  programId: string | null;
  studentId: string | null;
  type: EduAppointmentType | null;
  status: EduAppointmentStatus | null;
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  if (typeof value === "string") return value;
  return null;
}

/**
 * 🔴 Aquí NO se lee ningún institutionId. El tenant sale de la sesión y de
 * ningún otro lado; si esta función lo aceptara, bastaría con teclear
 * `?institutionId=…` para leer la agenda de otra escuela.
 *
 * El día por defecto es HOY EN EL INSTITUTO, no hoy en el servidor: si el
 * servidor corre en UTC y la escuela está en Tijuana, entre las 17:00 y la
 * medianoche los dos "hoy" son días distintos y la agenda abriría en el
 * día equivocado.
 */
export function parseEduAgendaQuery(
  searchParams: Record<string, string | string[] | undefined> | undefined | null,
  timeZone: string,
  now: Date = new Date(),
): EduAgendaQuery {
  const sp = searchParams ?? {};
  const vista = firstParam(sp.vista);
  return {
    view: vista === "semana" ? "semana" : "dia",
    dayISO: parseEduDayISO(firstParam(sp.dia)) ?? eduTodayISO(timeZone, now),
    chairId: eduCleanId(firstParam(sp.sillon)),
    programId: eduCleanId(firstParam(sp.programa)),
    studentId: eduCleanId(firstParam(sp.alumno)),
    type: parseEduAppointmentType(firstParam(sp.tipo)),
    status: parseEduAppointmentStatus(firstParam(sp.estado)),
  };
}

/** ¿Hay algún filtro puesto? (para pintar el botón de "limpiar"). */
export function eduHasAgendaFilters(q: EduAgendaQuery): boolean {
  return Boolean(q.chairId || q.programId || q.studentId || q.type || q.status);
}

// ═══════════════════════════════════════════════════════════════════════
// 9 · LAS FORMAS QUE VIAJAN A LA PANTALLA
//
// Viven AQUÍ, en el módulo puro, y no junto a las consultas, por la misma
// razón que en padron-core.ts: los componentes "use client" las necesitan y
// agenda.ts importa prisma. Un `import type` se borra al compilar — pero
// basta con que alguien le quite el `type` para arrastrar el runtime de
// Prisma al navegador. Si el tipo no vive ahí, no hay de dónde.
//
// Las fechas salen como string ISO y ADEMÁS con su etiqueta ya formateada
// en la hora del instituto: la pantalla no vuelve a formatear nada.
// ═══════════════════════════════════════════════════════════════════════

export interface EduChairScheduleRow {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface EduChairRow {
  id: string;
  name: string;
  number: number;
  isActive: boolean;
  orderIndex: number;
  schedules: EduChairScheduleRow[];
  /** Citas futuras que ya tiene. Lo lee el botón de desactivar. */
  upcoming: number;
  /** Ola 11 · en qué SEDE está esta unidad. */
  campusId: string;
  campusName: string;
  /**
   * La zona horaria de SU sede. Viaja con el sillón porque el horario de
   * un sillón está en la hora de PARED de su edificio: "abre a las 8" no
   * significa lo mismo en Tijuana que en Mérida.
   */
  campusTimezone: string;
}

export interface EduChairOption {
  id: string;
  name: string;
  number: number;
  isActive: boolean;
  /**
   * Ola 11. Viaja SIEMPRE, aunque el instituto tenga una sola sede: la
   * pantalla decide si lo pinta contando cuántas sedes distintas hay en la
   * lista, y para eso el dato tiene que estar. Con dos sedes hay dos
   * "Sillón 1" —el número es único DENTRO de la sede, porque es el que está
   * pintado en cada pared— y sin el nombre de la sede la agenda tendría dos
   * columnas idénticas.
   */
  campusId: string;
  campusName: string;
}

export interface EduAppointmentRow {
  id: string;
  startsAt: string;
  endsAt: string;
  /** Día de calendario EN EL INSTITUTO (para agrupar por columna). */
  dayISO: string;
  startLabel: string;
  endLabel: string;
  minutes: number;
  type: EduAppointmentType;
  status: EduAppointmentStatus;
  notes: string | null;

  patientId: string;
  patientName: string;
  patientFolio: string;

  studentId: string;
  studentName: string;
  studentMatricula: string;
  studentProgramId: string;
  studentProgramName: string;

  chairId: string;
  chairName: string;
  chairNumber: number;
  /** Ola 12: la sede del sillón. La pantalla la pinta SOLO cuando las
   *  filas cruzan más de una sede — con una sola es ruido (Ola 11). */
  chairCampusName: string;

  supervisorUserId: string | null;
  supervisorName: string | null;

  caseId: string | null;
  caseStatus: EduCaseStatus | null;
  caseProgramName: string | null;
}

export interface EduAgendaPage {
  rows: EduAppointmentRow[];
  /** Los días que cubre la vista, en orden. */
  days: string[];
  truncated: boolean;
}

export interface EduCaseRow {
  id: string;
  status: EduCaseStatus;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;

  patientId: string;
  patientName: string;
  patientFolio: string;

  studentId: string;
  studentName: string;
  studentMatricula: string;

  programId: string;
  programName: string;

  supervisorUserId: string | null;
  supervisorName: string | null;

  /** Citas que cuelgan del caso. La ficha lo pinta como "3 sesiones". */
  appointments: number;

  // ── Ola 6 · evaluación académica ──────────────────────────────────────

  /**
   * El procedimiento PRINCIPAL del caso, del catálogo de la Ola 5.
   *
   * 🔴 Es lo que hace contable un requisito del plan de estudios. Un caso
   * sin procedimiento no cuenta para ningún requisito que pida uno — y la
   * pantalla lo DICE en vez de dejarlo en cero sin explicación.
   */
  procedureId: string | null;
  procedureName: string | null;
  procedureCategory: string | null;

  /** De qué caso viene, si nació de un traspaso. */
  transferredFromCaseId: string | null;
  /** Por qué se traspasó. Va en el caso NUEVO: es su razón de existir. */
  transferReason: string | null;
}

/** Lo MÍNIMO que necesita un <select> del navegador. No se manda la fila
 *  entera "por si acaso": en este repo ya se pagó una vez ese hábito. */
export interface EduStudentOption {
  id: string;
  name: string;
  matricula: string;
  programId: string;
  programName: string;
  /** Titular vigente, para proponerlo solo al abrir un caso o una cita. */
  supervisorUserId: string | null;
  supervisorName: string | null;
}

export interface EduSupervisorOption {
  id: string;
  name: string;
  isActive: boolean;
}
