import type { Role } from "@prisma/client";
import type { AppointmentStatus } from "./types";

export type UserRole = Role;

interface Transition {
  from: AppointmentStatus;
  to: AppointmentStatus;
  allowedRoles: UserRole[];
  predicate?: (now: Date, appointmentStart: Date) => string | null;
}

const ADMINS: UserRole[] = ["SUPER_ADMIN", "ADMIN"];
const FRONT_DESK: UserRole[] = ["RECEPTIONIST", ...ADMINS];
const CLINICAL: UserRole[] = ["DOCTOR", ...ADMINS];

const NO_SHOW_GRACE_MS = 15 * 60 * 1000;

function noShowOk(now: Date, start: Date): string | null {
  return now.getTime() < start.getTime() + NO_SHOW_GRACE_MS
    ? "Solo se puede marcar no-show 15 min después de la hora de la cita."
    : null;
}

const TRANSITIONS: Transition[] = [
  // ── SCHEDULED ────────────────────────────────────────────────────
  { from: "SCHEDULED",   to: "CONFIRMED",   allowedRoles: FRONT_DESK },
  { from: "SCHEDULED",   to: "CHECKED_IN",  allowedRoles: FRONT_DESK },
  { from: "SCHEDULED",   to: "CANCELLED",   allowedRoles: FRONT_DESK },
  { from: "SCHEDULED",   to: "NO_SHOW",     allowedRoles: FRONT_DESK, predicate: noShowOk },

  // ── CONFIRMED ────────────────────────────────────────────────────
  { from: "CONFIRMED",   to: "CHECKED_IN",  allowedRoles: FRONT_DESK },
  // Atajos clínicos: si el paciente ya está esperando o el doctor empieza
  // sin pasar por check-in formal, permitimos IN_CHAIR / IN_PROGRESS
  // directo. Cubre el flujo "el paciente entra y el doctor lo empieza
  // a atender de una". El timeline registra los timestamps que falten
  // como null, no rompe analytics.
  { from: "CONFIRMED",   to: "IN_CHAIR",    allowedRoles: CLINICAL },
  { from: "CONFIRMED",   to: "IN_PROGRESS", allowedRoles: CLINICAL },
  { from: "CONFIRMED",   to: "CANCELLED",   allowedRoles: FRONT_DESK },
  { from: "CONFIRMED",   to: "NO_SHOW",     allowedRoles: FRONT_DESK, predicate: noShowOk },

  // ── CHECKED_IN ───────────────────────────────────────────────────
  // Transiciones para analytics — capturan tiempos intermedios
  // (sentar al paciente en sillón antes de iniciar consulta) y cierre
  // explícito del ciclo (checkout). Si no se usa IN_CHAIR, CHECKED_IN
  // puede ir directo a IN_PROGRESS.
  { from: "CHECKED_IN",  to: "IN_CHAIR",    allowedRoles: FRONT_DESK },
  { from: "CHECKED_IN",  to: "IN_PROGRESS", allowedRoles: CLINICAL },
  { from: "CHECKED_IN",  to: "CANCELLED",   allowedRoles: FRONT_DESK },

  // ── IN_CHAIR ─────────────────────────────────────────────────────
  { from: "IN_CHAIR",    to: "IN_PROGRESS", allowedRoles: CLINICAL },
  // Atajo: si el doctor ya terminó sin haber entrado en IN_PROGRESS
  // formalmente (ej. consulta de 5 min en sillón), permitimos COMPLETED
  // directo. Mejor que forzar al doctor a clickear 2 estados.
  { from: "IN_CHAIR",    to: "COMPLETED",   allowedRoles: CLINICAL },
  { from: "IN_CHAIR",    to: "CANCELLED",   allowedRoles: FRONT_DESK },

  // ── IN_PROGRESS ──────────────────────────────────────────────────
  { from: "IN_PROGRESS", to: "COMPLETED",   allowedRoles: CLINICAL },
  // Alias: marcar checkout directo cierra el ciclo (COMPLETED + checkout
  // en un solo click).
  { from: "IN_PROGRESS", to: "CHECKED_OUT", allowedRoles: CLINICAL },
  { from: "IN_PROGRESS", to: "CANCELLED",   allowedRoles: ADMINS },

  // ── COMPLETED ────────────────────────────────────────────────────
  { from: "COMPLETED",   to: "CHECKED_OUT", allowedRoles: FRONT_DESK },

  // ── CANCELLED / NO_SHOW (terminales con escape) ──────────────────
  { from: "CANCELLED",   to: "SCHEDULED",   allowedRoles: ADMINS },
  { from: "NO_SHOW",     to: "SCHEDULED",   allowedRoles: ADMINS },
];

export interface TransitionCheckResult {
  ok: boolean;
  error?: string;
}

export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
  role: UserRole,
  now: Date,
  appointmentStart: Date,
): TransitionCheckResult {
  if (from === to) {
    return { ok: false, error: "La cita ya está en ese estado." };
  }
  const t = TRANSITIONS.find((x) => x.from === from && x.to === to);
  if (!t) {
    return { ok: false, error: `Transición no permitida: ${from} → ${to}.` };
  }
  if (!t.allowedRoles.includes(role)) {
    return { ok: false, error: "No tienes permiso para este cambio de estado." };
  }
  if (t.predicate) {
    const err = t.predicate(now, appointmentStart);
    if (err) return { ok: false, error: err };
  }
  return { ok: true };
}

export function availableTransitions(
  from: AppointmentStatus,
  role: UserRole,
  now: Date,
  appointmentStart: Date,
): AppointmentStatus[] {
  return TRANSITIONS.filter((t) => {
    if (t.from !== from) return false;
    if (!t.allowedRoles.includes(role)) return false;
    if (t.predicate && t.predicate(now, appointmentStart)) return false;
    return true;
  }).map((t) => t.to);
}

export function sideEffectsOf(
  to: AppointmentStatus,
  now: Date,
): Partial<{ checkedInAt: Date; startedAt: Date; completedAt: Date }> {
  switch (to) {
    case "CHECKED_IN":  return { checkedInAt: now };
    case "IN_PROGRESS": return { startedAt: now };
    case "COMPLETED":   return { completedAt: now };
    // IN_CHAIR / CHECKED_OUT no tienen columna directa en Appointment;
    // sus timestamps viven en AppointmentTimeline (instrumentación
    // separada en el endpoint PATCH para upsert del timeline).
    default:            return {};
  }
}

/**
 * Mapping de status → campo del AppointmentTimeline. El endpoint PATCH
 * status route llama upsertTimelineForStatus(appointmentId, status, now)
 * para registrar el timestamp correspondiente, además del side effect
 * en la columna de Appointment cuando aplica.
 */
export function timelineFieldFor(
  status: AppointmentStatus,
): keyof TimelineUpdate | null {
  switch (status) {
    case "CHECKED_IN":  return "arrivedAt";
    case "IN_CHAIR":    return "inChairAt";
    case "IN_PROGRESS": return "consultStartAt";
    case "COMPLETED":   return "consultEndAt";
    case "CHECKED_OUT": return "checkoutAt";
    default:            return null;
  }
}

interface TimelineUpdate {
  arrivedAt: Date;
  inChairAt: Date;
  consultStartAt: Date;
  consultEndAt: Date;
  checkoutAt: Date;
}

export function canOverrideOverlap(role: UserRole): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}
