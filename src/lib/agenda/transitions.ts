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
  { from: "SCHEDULED",   to: "CONFIRMED",   allowedRoles: FRONT_DESK },
  { from: "SCHEDULED",   to: "CANCELLED",   allowedRoles: FRONT_DESK },
  { from: "SCHEDULED",   to: "NO_SHOW",     allowedRoles: FRONT_DESK, predicate: noShowOk },
  { from: "SCHEDULED",   to: "CHECKED_IN",  allowedRoles: FRONT_DESK },
  { from: "CONFIRMED",   to: "CHECKED_IN",  allowedRoles: FRONT_DESK },
  { from: "CONFIRMED",   to: "CANCELLED",   allowedRoles: FRONT_DESK },
  { from: "CONFIRMED",   to: "NO_SHOW",     allowedRoles: FRONT_DESK, predicate: noShowOk },
  { from: "CHECKED_IN",  to: "IN_PROGRESS", allowedRoles: CLINICAL },
  { from: "CHECKED_IN",  to: "CANCELLED",   allowedRoles: FRONT_DESK },
  { from: "IN_PROGRESS", to: "COMPLETED",   allowedRoles: CLINICAL },
  { from: "IN_PROGRESS", to: "CANCELLED",   allowedRoles: ADMINS },
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
    default:            return {};
  }
}

export function canOverrideOverlap(role: UserRole): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}
