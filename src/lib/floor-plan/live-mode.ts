/**
 * Helpers del modo En Vivo. Funciones puras que se reusan tanto en el
 * editor (/dashboard/clinic-layout) como en la URL pública (/live/[slug]).
 */

import type { ChairStatus, LiveAppointment } from "./element-types";

const PROXIMO_WINDOW_MIN = 30; // próxima cita en los siguientes 30 min

/**
 * Calcula el estado de un sillón en un momento dado, decidiendo por
 * Appointment.status (no solo por tiempo). El "viewTime" sigue siendo
 * relevante porque el timeline permite "viajar en el tiempo": cuando
 * viewTime está cerca de now usamos status real; cuando se viaja al
 * pasado/futuro caemos al cálculo por tiempo (el status real no aplica).
 *
 * - 'ocupado'  → hay appointment con status=IN_PROGRESS en este sillón
 *                (sin importar la hora). Si viewTime ≠ now, fallback a
 *                "cita cuyo rango contiene viewTime".
 * - 'proximo'  → próxima cita SCHEDULED|CONFIRMED|CHECKED_IN comienza en
 *                ≤ 30 min. El timeline también lo aplica al "viajar".
 * - 'libre'    → otros.
 */
export function getChairStatus(
  resourceId: string,
  viewTime: Date,
  appointments: LiveAppointment[],
): ChairStatus {
  const now = viewTime.getTime();
  const isLive = Math.abs(Date.now() - now) < 90_000;

  // Activa = status IN_PROGRESS si estamos en tiempo real, o por rango
  // si el usuario viajó por timeline.
  for (const a of appointments) {
    if (a.resourceId !== resourceId) continue;
    if (isLive) {
      if (a.status === "IN_PROGRESS") return "ocupado";
    } else {
      const s = a.start.getTime();
      const e = a.end.getTime();
      if (s <= now && now < e) return "ocupado";
    }
  }

  // Próxima en ≤ 30 min con status válido (aún no iniciada).
  const PROXIMA_STATUSES: ReadonlySet<string> = new Set([
    "SCHEDULED",
    "CONFIRMED",
    "CHECKED_IN",
    "PENDING",
  ]);
  for (const a of appointments) {
    if (a.resourceId !== resourceId) continue;
    const s = a.start.getTime();
    const diffMin = (s - now) / 60_000;
    if (diffMin > 0 && diffMin <= PROXIMO_WINDOW_MIN) {
      // Si tenemos status, exigimos que sea uno "futuro válido". Si no
      // tenemos status (datos legacy), aceptamos.
      if (!a.status || PROXIMA_STATUSES.has(a.status)) return "proximo";
    }
  }
  return "libre";
}

/**
 * Cita ACTIVA en este momento para el sillón, o null. Decide por status
 * IN_PROGRESS si estamos en vivo; si no, por rango temporal.
 */
export function getChairAppointment(
  resourceId: string,
  viewTime: Date,
  appointments: LiveAppointment[],
): LiveAppointment | null {
  const now = viewTime.getTime();
  const isLive = Math.abs(Date.now() - now) < 90_000;

  if (isLive) {
    for (const a of appointments) {
      if (a.resourceId === resourceId && a.status === "IN_PROGRESS") return a;
    }
  }
  for (const a of appointments) {
    if (a.resourceId !== resourceId) continue;
    if (a.start.getTime() <= now && now < a.end.getTime()) return a;
  }
  return null;
}

/** Próxima cita futura (no activa) para el sillón, o null. */
export function getNextChairAppointment(
  resourceId: string,
  viewTime: Date,
  appointments: LiveAppointment[],
): LiveAppointment | null {
  const now = viewTime.getTime();
  let best: LiveAppointment | null = null;
  for (const a of appointments) {
    if (a.resourceId !== resourceId) continue;
    if (a.start.getTime() <= now) continue;
    if (!best || a.start.getTime() < best.start.getTime()) best = a;
  }
  return best;
}

/** Formatea HH:MM (24h). */
export function fmtHM(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** Formatea HH:MM:SS (24h, tabular). */
export function fmtHMS(d: Date): string {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Aplica privacy: si showFullNames=false, devuelve iniciales tipo "M.G."
 * en lugar del nombre completo. El tratamiento NO identifica al paciente
 * y siempre se muestra completo.
 */
export function maskPatient(name: string, showFullNames: boolean): string {
  if (showFullNames) return name;
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "—";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join(".") + ".";
}

/** Progreso 0..1 de una cita activa en el momento dado. */
export function appointmentProgress(a: LiveAppointment, viewTime: Date): number {
  const s = a.start.getTime();
  const e = a.end.getTime();
  if (e <= s) return 0;
  return Math.max(0, Math.min(1, (viewTime.getTime() - s) / (e - s)));
}

/** Inicio del día (8:00) y fin (20:00) para el rango de timeline. */
export const TIMELINE_START_HOUR = 8;
export const TIMELINE_END_HOUR = 20;

/** Fracción 0..1 del momento dado dentro del rango del timeline. */
export function timelineFraction(d: Date): number {
  const start = new Date(d);
  start.setHours(TIMELINE_START_HOUR, 0, 0, 0);
  const end = new Date(d);
  end.setHours(TIMELINE_END_HOUR, 0, 0, 0);
  const total = end.getTime() - start.getTime();
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (d.getTime() - start.getTime()) / total));
}

/** Convierte fracción de timeline a Date dentro del día visible. */
export function timelineFractionToDate(frac: number, base: Date): Date {
  const start = new Date(base);
  start.setHours(TIMELINE_START_HOUR, 0, 0, 0);
  const end = new Date(base);
  end.setHours(TIMELINE_END_HOUR, 0, 0, 0);
  const total = end.getTime() - start.getTime();
  return new Date(start.getTime() + Math.max(0, Math.min(1, frac)) * total);
}
