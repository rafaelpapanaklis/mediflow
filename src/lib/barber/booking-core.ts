/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — núcleo PURO de la reserva pública.

   Sin prisma, sin "server-only", sin next: solo funciones. Aquí vive la
   aritmética que decide qué horarios existen, y por eso se puede probar de
   verdad (src/lib/barber/__tests__/booking-core.test.ts) sin levantar una
   base de datos. La capa con prisma es src/lib/barber/booking.ts, que
   re-exporta todo esto.

   Mismo criterio que el resto del repo: la lógica que se quiere probar vive
   en un módulo -core sin dependencias de servidor.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Parámetros del embudo ───────────────────────────────────────────────

/** Rejilla de horarios que se le ofrece al cliente (minutos). */
export const BARBER_SLOT_STEP_MIN = 15;
/** Cuántos días hacia adelante se puede reservar. */
export const BARBER_MAX_DAYS_AHEAD = 60;
/** Colchón mínimo desde "ahora": nadie reserva para dentro de un ratito. */
export const BARBER_MIN_LEAD_MIN = 30;
/** Tope de citas futuras vivas por teléfono y barbería (anti-abuso). */
export const BARBER_MAX_OPEN_PER_PHONE = 3;
/**
 * Estados que OCUPAN el sillón (los demás liberan el hueco).
 *
 * Es el COMPLEMENTO exacto de BARBER_NON_BLOCKING_STATUSES de
 * src/lib/barber/agenda.ts (T1) y del WHERE de la constraint EXCLUDE
 * barber_appt_no_overlap: CANCELLED y NO_SHOW no bloquean, el resto sí. Si
 * una de las tres cambia, las tres cambian.
 */
export const BARBER_BUSY_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "DONE",
] as const;

// ── Zona horaria ────────────────────────────────────────────────────────
// Espejo puro de los helpers del dental (src/lib/agenda/time-utils.ts). Se
// replican a propósito: el vertical barber no cuelga de módulos del producto
// dental (mismo criterio que permissions.ts y plans.ts en la Ola 0).

const WEEKDAY: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export interface BarberTzParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = domingo (criterio JS getDay(), igual que BarberSchedule.dayOfWeek). */
  weekday: number;
}

/** Descompone un instante en las partes de calendario de `timezone`. */
export function getBarberTzParts(date: Date, timezone: string): BarberTzParts {
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
  // Intl con hour12:false devuelve "24" para la medianoche en algunos ICU.
  const rawHour = parseInt(map.get("hour") ?? "0", 10);
  return {
    year: parseInt(map.get("year") ?? "1970", 10),
    month: parseInt(map.get("month") ?? "1", 10),
    day: parseInt(map.get("day") ?? "1", 10),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: parseInt(map.get("minute") ?? "0", 10),
    weekday: WEEKDAY[map.get("weekday") ?? "Sun"] ?? 0,
  };
}

/** "2026-08-24" + 14:30 en `timezone` → el instante UTC correspondiente. */
export function barberTzLocalToUtc(
  dateISO: string,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  const probeUtc = new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0));
  const parts = getBarberTzParts(probeUtc, timezone);
  const desired = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  const tzSeesAs = Date.UTC(
    parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0,
  );
  return new Date(desired - (tzSeesAs - desired));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** El día de HOY en la zona de la barbería, como "YYYY-MM-DD". */
export function barberTodayISO(timezone: string, now: Date = new Date()): string {
  const p = getBarberTzParts(now, timezone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Minutos desde medianoche AHORA, en la zona de la barbería. */
export function barberNowMinutes(timezone: string, now: Date = new Date()): number {
  const p = getBarberTzParts(now, timezone);
  return p.hour * 60 + p.minute;
}

/** "YYYY-MM-DD" → día de la semana 0-6 (0 = domingo). Independiente de la tz
 *  del servidor: se calcula sobre la fecha calendario, no sobre un instante. */
export function isoDateWeekday(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Suma días a una fecha "YYYY-MM-DD" sin salir del calendario. */
export function addIsoDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Distancia en días entre dos fechas "YYYY-MM-DD" (b - a). */
export function isoDaysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** ¿"YYYY-MM-DD" es una fecha real del calendario? */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((n) => parseInt(n, 10));
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/** "HH:MM" → minutos desde medianoche, o null si no es una hora válida. */
export function parseHhMm(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(":").map((n) => parseInt(n, 10));
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Minutos desde medianoche → "HH:MM". */
export function minutesToHhMm(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

// ── Lista BLANCA de salida pública ──────────────────────────────────────

/**
 * Los ÚNICOS campos de la barbería que pueden salir a una página pública.
 *
 * Es una lista blanca, no una lista negra, y por eso se puede probar: pasar
 * una fila entera de Barbershop por pickPublicShop() y comprobar que del
 * otro lado no aparece un token de WhatsApp ni un id de Stripe. El producto
 * dental tuvo una fuga REAL por mandar la fila completa de la clínica al
 * navegador; aquí eso no puede pasar por construcción.
 */
export const PUBLIC_SHOP_FIELDS = [
  "id",
  "name",
  "slug",
  "phone",
  "address",
  "city",
  "state",
  "timezone",
  "locale",
  "logoUrl",
  "branchName",
] as const;

export interface PublicBarbershopDTO {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  locale: string;
  logoUrl: string | null;
  branchName: string | null;
}

/** Recorta CUALQUIER fila a la lista blanca. Lo que no está, no sale. */
export function pickPublicShop(row: Record<string, unknown>): PublicBarbershopDTO {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_SHOP_FIELDS) out[key] = row[key] ?? null;
  return out as unknown as PublicBarbershopDTO;
}

// ── Motor de disponibilidad ─────────────────────────────────────────────

export interface BusyInterval {
  startMs: number;
  endMs: number;
}

/** Solape de intervalos medio abiertos [inicio, fin). */
export function overlaps(startMs: number, endMs: number, busy: BusyInterval[]): boolean {
  return busy.some((b) => b.startMs < endMs && b.endMs > startMs);
}

export interface BarberSlotDTO {
  /** "HH:MM" en la zona de la barbería. */
  time: string;
  /** Cuántos barberos pueden atenderlo a esa hora (nunca sus ids). */
  available: number;
}

export interface AvailabilityData {
  /** En el orden que la barbería definió (sortOrder → name). */
  barberIds: string[];
  schedules: { barberId: string; dayOfWeek: number; startMinute: number; endMinute: number }[];
  /** Ocupado por barbero: bloqueos propios + bloqueos de barbería + citas. */
  busyByBarber: Map<string, BusyInterval[]>;
}

/**
 * Los barberos libres por horario en UN día, sobre datos ya cargados.
 *
 * Un hueco existe si, para algún barbero:
 *   · cae COMPLETO dentro de un turno suyo de BarberSchedule ese día;
 *   · no lo pisa un bloqueo suyo NI uno de barbería completa;
 *   · no se solapa con ninguna cita suya que ocupe el sillón.
 *
 * OJO con las citas de barberId null ("cualquier barbero", que el panel sí
 * puede crear): NO se cuentan aquí. Bloquear a todos los barberos por una
 * cita sin dueño cerraría la barbería entera; ignorarla puede empalmar un
 * sillón. Se ignora a propósito y queda anotado para consolidar con T1,
 * dueño de la agenda del panel.
 */
export function computeFreeBarbersForDay(
  data: AvailabilityData,
  dateISO: string,
  durationMin: number,
  timezone: string,
  now: Date,
): Map<string, string[]> {
  const free = new Map<string, string[]>();
  if (data.barberIds.length === 0 || durationMin <= 0) return free;

  const dayOfWeek = isoDateWeekday(dateISO);
  // Piso temporal: en el día en curso no se ofrece lo que ya pasó.
  const floorMinutes =
    dateISO === barberTodayISO(timezone, now)
      ? barberNowMinutes(timezone, now) + BARBER_MIN_LEAD_MIN
      : -1;

  for (const s of data.schedules) {
    if (s.dayOfWeek !== dayOfWeek) continue;
    const busy = data.busyByBarber.get(s.barberId) ?? [];
    const last = s.endMinute - durationMin;
    // La rejilla se ancla a la hora en punto (0, 15, 30, 45), no al inicio
    // del turno: un turno que abre a las 9:05 ofrece 9:15, no 9:05.
    const first = Math.ceil(s.startMinute / BARBER_SLOT_STEP_MIN) * BARBER_SLOT_STEP_MIN;
    for (let m = first; m <= last; m += BARBER_SLOT_STEP_MIN) {
      if (m <= floorMinutes) continue;
      const startMs = barberTzLocalToUtc(
        dateISO, Math.floor(m / 60), m % 60, timezone,
      ).getTime();
      if (overlaps(startMs, startMs + durationMin * 60_000, busy)) continue;
      const key = minutesToHhMm(m);
      const list = free.get(key);
      if (list) {
        if (list.indexOf(s.barberId) < 0) list.push(s.barberId);
      } else {
        free.set(key, [s.barberId]);
      }
    }
  }

  // Se respeta el orden que la barbería definió: quien reparte "cualquiera
  // disponible" toma de esta lista.
  const rank = new Map<string, number>();
  data.barberIds.forEach((id, i) => rank.set(id, i));
  for (const list of Array.from(free.values())) {
    list.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  }
  return free;
}

/** Mapa de libres → lo que se publica: hora + cuántos barberos hay. */
export function toPublicSlots(free: Map<string, string[]>): BarberSlotDTO[] {
  return Array.from(free.entries())
    .map(([time, ids]) => ({ time, available: ids.length }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Clave de candado para pg_advisory_xact_lock. Se usa la sobrecarga de DOS
 * int4 (no la de un int8) para no depender de literales BigInt: el tsconfig
 * del repo compila a un target que no los admite.
 *
 * Dos hashes de 32 bits con semillas distintas del MISMO string: la
 * probabilidad de que dos barberías-día distintas colisionen en los 64 bits
 * es despreciable, y una colisión solo costaría que dos reservas ajenas
 * esperen una por la otra unos milisegundos — nunca un dato incorrecto.
 */
export function advisoryLockKey(key: string): [number, number] {
  const hash = (seed: number): number => {
    let h = seed;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      // FNV-1a de 32 bits con Math.imul (evita perder bits en el double).
      h = Math.imul(h, 0x01000193);
    }
    return h | 0; // a int4 con signo, que es justo lo que espera Postgres
  };
  return [hash(0x811c9dc5 | 0), hash(0x9e3779b9 | 0)];
}

/** Referencia visible para el cliente: 6 caracteres, no es el id de la cita. */
export function shortReference(id: string): string {
  return id.slice(-6).toUpperCase();
}

/**
 * De los barberos libres a esa hora, el que MENOS citas tiene ese día — así
 * "cualquiera disponible" reparte el trabajo en vez de saturar al primero de
 * la lista. Empate: gana el orden que la barbería definió (los candidatos ya
 * llegan ordenados desde computeFreeBarbersForDay).
 */
export function pickLeastBusy(
  candidates: string[],
  load: Map<string, number>,
): string | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestLoad = load.get(best) ?? 0;
  for (const id of candidates.slice(1)) {
    const l = load.get(id) ?? 0;
    if (l < bestLoad) {
      best = id;
      bestLoad = l;
    }
  }
  return best;
}
