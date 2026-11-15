// ═══════════════════════════════════════════════════════════════════════
// Núcleo PURO de la ventana de la cita (mockup B, ws6-t8, 15-nov-2026).
//
// Sin React, sin fetch: lo que decide QUÉ se pinta y QUÉ hueco se propone
// vive aquí para poder probarlo (__tests__/cita-core.test.ts) sin navegador.
//
//   · citaSteps()        → el recorrido Pendiente → Confirmada → En silla → Completada
//   · usualReturnWeeks() → «suele volver cada X semanas», de sus visitas
//   · findNextVisitSlot()→ «Agendar su próxima»: misma hora y barbero N semanas
//                          después, o los huecos más cercanos de ese día
//   · parseDepositAmount → el monto del anticipo, en centavos enteros
//   · routeSupports()    → si una ruta del servidor ya existe (botones nuevos)
// ═══════════════════════════════════════════════════════════════════════
import type {
  BarberAppointmentDTO,
  BarberAppointmentStatus,
  BarberScheduleDTO,
  BarberTimeOffDTO,
} from "@/lib/barber/types";
import {
  BARBER_BUSY_STATUSES,
  computeFreeBarbersForDay,
  type AvailabilityData,
  type BusyInterval,
} from "@/lib/barber/booking-core";
import { addDaysISO, shopDateISO, shopLocalToUtc, shopMinuteOfDay } from "@/lib/barber/agenda";

// ── Lo que agrega ws6-t5 al DTO (contrato fijo) ─────────────────────────
// Mientras su rama no esté unida, estos campos no llegan y todo se pinta
// sin ellos. Se declaran OPCIONALES aquí, no en types.ts, para no chocar
// con su cambio al contrato compartido.
export interface CitaExtras {
  arrivedAt?: string | null;
  cancelReason?: string | null;
  deposit?: { status: string; amount: number | null } | null;
  client?: { totalVisits: number; stars: number } | null;
}
export type CitaDTO = BarberAppointmentDTO & CitaExtras;

// ── Recorrido de la visita ──────────────────────────────────────────────
export const CITA_STEPS: BarberAppointmentStatus[] = ["PENDING", "CONFIRMED", "IN_PROGRESS", "DONE"];

export type StepState = "done" | "now" | "next";

/**
 * Estado de cada paso del recorrido. Cancelada y «no llegó» no tienen paso
 * propio: devuelven null y la ventana pinta un aviso en su lugar.
 */
export function citaSteps(
  status: BarberAppointmentStatus,
): { status: BarberAppointmentStatus; state: StepState }[] | null {
  const at = CITA_STEPS.indexOf(status);
  if (at < 0) return null;
  return CITA_STEPS.map((s, i) => ({
    status: s,
    // Completada es el final: no queda nada «por venir», se pinta hecha.
    state: i < at || (status === "DONE" && i === at) ? "done" : i === at ? "now" : "next",
  }));
}

// ── «Suele volver cada X semanas» ───────────────────────────────────────
/** Visitas necesarias para afirmar un ritmo (2 intervalos). */
export const USUAL_RETURN_MIN_VISITS = 3;
/** Más allá de esto no es un ritmo, es un cliente que va y viene. */
export const USUAL_RETURN_MAX_WEEKS = 12;

/**
 * Mediana de los intervalos entre visitas reales, redondeada a semanas.
 * `visits` son fechas ISO de visitas que SÍ pasaron (completadas o cobradas).
 * Dos visitas el mismo día cuentan como una. null si no hay ritmo claro.
 */
export function usualReturnWeeks(visits: string[], timezone: string): number | null {
  // El día se cuenta en la hora de la barbería: una visita de las 18:00 en
  // CDMX ya es «mañana» en UTC.
  const days = Array.from(
    new Set(
      visits
        .map((v) => new Date(v))
        .filter((d) => Number.isFinite(d.getTime()))
        .map((d) => Date.parse(`${shopDateISO(d, timezone)}T00:00:00Z`) / 86_400_000),
    ),
  ).sort((a, b) => a - b);
  if (days.length < USUAL_RETURN_MIN_VISITS) return null;
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  const weeks = Math.round(median / 7);
  if (weeks < 1 || weeks > USUAL_RETURN_MAX_WEEKS) return null;
  return weeks;
}

/** Opciones de «Agendar su próxima»: 2, 3, 4 y, si suele volver en otro ritmo, ese también. */
export const NEXT_VISIT_WEEKS = [2, 3, 4] as const;

export function nextVisitOptions(usual: number | null): number[] {
  const out: number[] = [...NEXT_VISIT_WEEKS];
  if (usual && !out.includes(usual)) out.push(usual);
  return out.sort((a, b) => a - b);
}

// ── «Agendar su próxima»: buscar el hueco ───────────────────────────────
/** Huecos alternativos que se ofrecen si la misma hora no está libre. */
export const NEXT_VISIT_ALTERNATIVES = 3;

export interface DayWindow {
  schedules: BarberScheduleDTO[];
  timeOff: BarberTimeOffDTO[];
  appointments: Pick<BarberAppointmentDTO, "barberId" | "startAt" | "endAt" | "status">[];
  barbers: { id: string; isActive: boolean }[];
}

export interface NextSlot {
  startAt: Date;
  barberId: string;
  /** Es la misma hora de la visita original. */
  exact: boolean;
}

export interface NextVisitResult {
  dateISO: string;
  /** Misma hora y barbero, libre. */
  exact: NextSlot | null;
  /** Si no: los más cercanos a esa hora el mismo día (con el mismo barbero). */
  nearby: NextSlot[];
}

/**
 * Los datos de UN día (lo que devuelve GET /api/barber/appointments?days=1)
 * → el formato del motor de disponibilidad de la reserva pública, para un
 * solo barbero. Mismo criterio que loadAvailabilityData (booking.ts): los
 * bloqueos de barbería entera pisan a todos; las visitas canceladas o «no
 * llegó» no ocupan el sillón.
 */
export function availabilityForBarber(day: DayWindow, barberId: string): AvailabilityData {
  const active = day.barbers.some((b) => b.id === barberId && b.isActive);
  if (!active) return { barberIds: [], schedules: [], busyByBarber: new Map() };
  const busy: BusyInterval[] = [];
  const toBusy = (a: { startAt: string; endAt: string }) => ({
    startMs: new Date(a.startAt).getTime(),
    endMs: new Date(a.endAt).getTime(),
  });
  for (const t of day.timeOff) {
    if (t.barberId === null || t.barberId === barberId) busy.push(toBusy(t));
  }
  const busyStatuses = BARBER_BUSY_STATUSES as readonly string[];
  for (const a of day.appointments) {
    if (a.barberId === barberId && busyStatuses.includes(a.status)) busy.push(toBusy(a));
  }
  return {
    barberIds: [barberId],
    schedules: day.schedules
      .filter((s) => s.barberId === barberId && s.isActive)
      .map((s) => ({
        barberId: s.barberId,
        dayOfWeek: s.dayOfWeek,
        startMinute: s.startMinute,
        endMinute: s.endMinute,
      })),
    busyByBarber: new Map([[barberId, busy]]),
  };
}

/** Fecha (en la barbería) de la visita N semanas después. */
export function nextVisitDateISO(startAt: string, weeks: number, timezone: string): string {
  return addDaysISO(shopDateISO(new Date(startAt), timezone), weeks * 7);
}

/**
 * El hueco de «su próxima». Primero la MISMA hora con el MISMO barbero; si
 * no cabe, los `NEXT_VISIT_ALTERNATIVES` huecos de ese día más cercanos a esa
 * hora (empate → el más temprano). Sin barbero en la visita, no se adivina:
 * null y la pantalla manda a «Repetir esta cita».
 */
export function findNextVisitSlot(args: {
  appointment: Pick<BarberAppointmentDTO, "startAt" | "endAt" | "barberId">;
  weeks: number;
  timezone: string;
  day: DayWindow;
  now: Date;
}): NextVisitResult | null {
  const { appointment, weeks, timezone, day, now } = args;
  const barberId = appointment.barberId;
  if (!barberId) return null;
  const durationMin = Math.round(
    (new Date(appointment.endAt).getTime() - new Date(appointment.startAt).getTime()) / 60_000,
  );
  if (durationMin <= 0) return null;
  const dateISO = nextVisitDateISO(appointment.startAt, weeks, timezone);
  const wanted = shopMinuteOfDay(new Date(appointment.startAt), timezone);

  const free = computeFreeBarbersForDay(
    availabilityForBarber(day, barberId),
    dateISO,
    durationMin,
    timezone,
    now,
  );
  const minutes = Array.from(free.keys()).map((hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  });
  const slotAt = (minute: number, exact: boolean): NextSlot => ({
    startAt: shopLocalToUtc(dateISO, minute, timezone),
    barberId,
    exact,
  });

  if (minutes.includes(wanted)) {
    return { dateISO, exact: slotAt(wanted, true), nearby: [] };
  }
  const nearby = minutes
    .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b)
    .slice(0, NEXT_VISIT_ALTERNATIVES)
    .sort((a, b) => a - b)
    .map((m) => slotAt(m, false));
  return { dateISO, exact: null, nearby };
}

// ── Anticipo: el monto que se escribe ───────────────────────────────────
/**
 * "150", "150.5", "$1,200.00" → pesos con 2 decimales exactos (sin errores
 * de coma flotante: se trabaja en centavos). null si no es un monto válido
 * o si pasa del total de la cita (un anticipo no puede ser mayor que lo que
 * se va a cobrar).
 */
export function parseDepositAmount(raw: string, maxPesos: number | null): number | null {
  const clean = raw.replace(/[$\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  if (maxPesos !== null && cents > Math.round(maxPesos * 100)) return null;
  return cents / 100;
}

// ── ¿La ruta ya existe? (botones de ws6-t5) ─────────────────────────────
/**
 * Lee la respuesta a un OPTIONS: Next contesta 404 a una ruta que no existe
 * y, a una que sí, la cabecera Allow con sus métodos (la arma solo).
 * Sin cabecera Allow no se puede saber el método: se da por bueno.
 */
export function routeSupports(status: number, allow: string | null, method: string): boolean {
  if (status === 404) return false;
  if (status >= 500) return false;
  if (!allow) return true;
  return allow
    .split(",")
    .map((m) => m.trim().toUpperCase())
    .includes(method.toUpperCase());
}

// ── Motivo de cancelación ───────────────────────────────────────────────
/** Los motivos rápidos (la pantalla los traduce). Decisión pendiente de Rafael. */
export const CANCEL_REASONS = ["client", "noAnswer", "shop"] as const;
export type CancelReasonKey = (typeof CANCEL_REASONS)[number];
/** Tope del texto libre del motivo. */
export const CANCEL_REASON_MAX = 200;

/** Lo que viaja al servidor: el texto del motivo elegido o escrito, o null. */
export function cancelReasonText(picked: string | null, typed: string): string | null {
  const free = typed.trim().slice(0, CANCEL_REASON_MAX);
  if (free) return picked ? `${picked} · ${free}`.slice(0, CANCEL_REASON_MAX) : free;
  return picked;
}

/**
 * Cuerpo del POST /api/barber/appointments/<id>/deposit. El servidor lee el
 * método de `paymentMethod`: con otro nombre responde 400 «Elige cómo pagó»
 * aunque el botón «Efectivo» se vea marcado (así se rompió en panel.108).
 */
export function depositBody(amount: number, method: string): { amount: number; paymentMethod: string } {
  return { amount, paymentMethod: method };
}
