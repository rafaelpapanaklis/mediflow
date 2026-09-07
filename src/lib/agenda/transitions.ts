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
  // Mismos atajos clínicos que CONFIRMED: en la práctica muchas citas nunca
  // pasan por "Confirmada" y el doctor arranca directo desde "Agendada".
  // Sin estas dos entradas, al volver canTransition una validación real ese
  // flujo cotidiano quedaría bloqueado con un 409.
  { from: "SCHEDULED",   to: "IN_CHAIR",    allowedRoles: CLINICAL },
  { from: "SCHEDULED",   to: "IN_PROGRESS", allowedRoles: CLINICAL },
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
  // Escape para el clic equivocado (se completó la cita que no era), simétrico
  // a los de CANCELLED/NO_SHOW y también solo de admin: revierte el estado,
  // no la firma de la nota (esa queda en el expediente y en el AuditLog).
  { from: "COMPLETED",   to: "SCHEDULED",   allowedRoles: ADMINS },

  // ── CANCELLED / NO_SHOW (terminales con escape) ──────────────────
  { from: "CANCELLED",   to: "SCHEDULED",   allowedRoles: ADMINS },
  { from: "NO_SHOW",     to: "SCHEDULED",   allowedRoles: ADMINS },
];

export interface TransitionCheckResult {
  ok: boolean;
  error?: string;
  /**
   * Por qué falló, para que el endpoint elija el status HTTP: `forbidden_role`
   * es un problema de PERMISO (403); el resto son de ESTADO (409).
   */
  code?: "same_status" | "not_allowed" | "forbidden_role";
}

/**
 * Validación REAL de la máquina de estados: la transición debe existir en
 * TRANSITIONS, el rol debe estar en su allowlist y su predicate (si tiene)
 * debe pasar. Antes esto era un no-op que devolvía {ok:true} siempre
 * (P1-1 auditoría 2026-08-06): cualquier sesión de la clínica —READONLY
 * incluido— cancelaba o completaba cualquier cita por PATCH /status, y el
 * requireRole del DELETE era teatro porque /status lo puenteaba. READONLY no
 * aparece en ninguna allowlist: para él toda transición es forbidden_role.
 */
export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
  role: UserRole,
  now: Date,
  appointmentStart: Date,
): TransitionCheckResult {
  if (from === to) {
    return { ok: false, code: "same_status", error: "La cita ya está en ese estado." };
  }
  const entry = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!entry) {
    return {
      ok: false,
      code: "not_allowed",
      error: `No se puede pasar una cita de ${from} a ${to}.`,
    };
  }
  if (!entry.allowedRoles.includes(role)) {
    return {
      ok: false,
      code: "forbidden_role",
      error: "Tu rol no permite este cambio de estado.",
    };
  }
  const predicateError = entry.predicate ? entry.predicate(now, appointmentStart) : null;
  if (predicateError) {
    return { ok: false, code: "not_allowed", error: predicateError };
  }
  return { ok: true };
}

/**
 * Cerrar una TELECONSULTA (POST /api/teleconsulta/end).
 *
 * Colgar la videollamada es a la vez iniciar y cerrar la consulta: nada en el
 * flujo de teleconsulta mueve la cita a IN_PROGRESS (ni `/room` ni `/join`
 * tocan el status), así que al colgar suele seguir en SCHEDULED o CONFIRMED.
 * Validar `X → COMPLETED` a secas daría 409 en el 100% de las teleconsultas
 * reales; ampliar la matriz con SCHEDULED → COMPLETED aflojaría también
 * /status y /complete.
 *
 * La salida: se valida el camino de DOS saltos que de hecho ocurrió,
 * `estado → IN_PROGRESS → COMPLETED`. Desde CANCELLED / NO_SHOW / COMPLETED /
 * CHECKED_OUT no hay salto a IN_PROGRESS, así que esos siguen rechazados — que
 * era el agujero (P1-1: la ruta escribía COMPLETED sin ninguna validación de
 * estado).
 */
export function canCloseTeleconsulta(
  from: AppointmentStatus,
  role: UserRole,
  now: Date,
  appointmentStart: Date,
): TransitionCheckResult {
  if (from === "IN_PROGRESS") {
    return canTransition("IN_PROGRESS", "COMPLETED", role, now, appointmentStart);
  }
  const start = canTransition(from, "IN_PROGRESS", role, now, appointmentStart);
  if (!start.ok) return start;
  return canTransition("IN_PROGRESS", "COMPLETED", role, now, appointmentStart);
}

export function availableTransitions(
  from: AppointmentStatus,
  role: UserRole,
  now: Date,
  appointmentStart: Date,
): AppointmentStatus[] {
  return possibleTransitions(from, { role, now, appointmentStart });
}

export interface PossibleTransitionsOptions {
  /**
   * Rol de quien mira. Si viene, se filtra además por su allowlist. El panel
   * de la agenda todavía NO lo recibe (el rol no baja al cliente por ese
   * árbol de props), así que llama sin él y obtiene el filtro estructural.
   */
  role?: UserRole;
  /** Para evaluar los predicates (hoy solo la gracia de 15 min del no-show). */
  now?: Date;
  appointmentStart?: Date;
}

/**
 * Targets a los que una cita en `from` PUEDE pasar según la matriz. Es lo que
 * la UI usa para pintar botones, y por eso tiene que decir la verdad.
 *
 * 🔴 Antes devolvía "todos los estados menos el actual", ignorando la matriz
 * entera (hallazgos 33 y 39, comprobados en la app real): el panel de detalle
 * pintaba ocho botones en cualquier estado y el servidor rechazaba los
 * inválidos con 409. En CHECKED_OUT ofrecía cuatro transiciones y las cuatro
 * fallaban; en una cita COMPLETADA ofrecía "Cancelar", que también fallaba.
 *
 * Sin `role` el filtro es solo ESTRUCTURAL (qué permite la matriz desde ese
 * estado, para cualquier rol) — que es el contrato que ya estaba documentado
 * aquí y el que usa el panel. Con `role` filtra también por su allowlist, y
 * con `now`/`appointmentStart` aplica los predicates. El server sigue siendo
 * la última palabra: `canTransition` en PATCH /api/appointments/[id]/status.
 */
export function possibleTransitions(
  from: AppointmentStatus,
  opts: PossibleTransitionsOptions = {},
): AppointmentStatus[] {
  const { role, now, appointmentStart } = opts;
  const out: AppointmentStatus[] = [];
  for (const t of TRANSITIONS) {
    if (t.from !== from) continue;
    if (role && !t.allowedRoles.includes(role)) continue;
    if (t.predicate && now && appointmentStart && t.predicate(now, appointmentStart)) continue;
    if (!out.includes(t.to)) out.push(t.to);
  }
  return out;
}

/**
 * Detecta el rechazo de la constraint EXCLUDE de Postgres sobre `appointments`
 * (`appt_doctor_no_overlap`, SQLSTATE 23P01): dos citas solapadas del mismo
 * doctor o del mismo recurso. Es la ÚLTIMA palabra sobre dobles reservas —
 * dos peticiones simultáneas pueden pasar las dos el pre-chequeo en memoria,
 * pero solo una entra.
 *
 * 🔴 Hallazgo 32: mirar solo `.code` NO alcanza y por eso el usuario veía un
 * 500 crudo en vez del 409 con el nombre de la cita en conflicto. Postgres no
 * tiene mapeo Prisma para 23P01, así que en un `create()` por ORM el error
 * llega como PrismaClientUnknownRequestError SIN `.code`, con el SQLSTATE y el
 * texto de la constraint metidos dentro de `.message`. Gemelo dental de
 * `isBarberOverlapError` (src/lib/barber/agenda.ts), que ya reconocía las tres
 * formas.
 */
export function isAppointmentOverlapError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; meta?: { code?: string }; message?: unknown };
  if (e.code === "P2010") return e.meta?.code === "23P01";
  if (e.code === "23P01") return true;
  if (typeof e.message !== "string") return false;
  // Sin nombre de constraint cableado: sobre `appointments` la única familia de
  // EXCLUDE es la de no-solape (doctor y recurso).
  return e.message.includes("23P01") || e.message.includes("exclusion constraint");
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
