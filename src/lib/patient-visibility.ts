import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Visibilidad por paciente — patients.visibleUserIds
 * ═══════════════════════════════════════════════════
 *
 * Al crear un paciente, el creador elige qué miembros del equipo pueden verlo.
 *
 * SEMÁNTICA de la columna:
 *   []       → TODOS lo ven. Es el comportamiento histórico y el default: un
 *              paciente sin lista se comporta EXACTAMENTE como antes de esta
 *              feature (los doctores siguen sujetos a las heurísticas de
 *              buildPatientWhere en @/lib/auth-context).
 *   NO vacío → lo ven SOLO esos userIds + CUALQUIER admin. La lista concede Y
 *              restringe: manda sobre las heurísticas (un doctor con cita del
 *              paciente NO lo ve si no está en la lista).
 *
 * Los admins (ADMIN / SUPER_ADMIN) normalmente NO se guardan en la lista: la
 * regla los cubre implícito, así que "admin nuevo" ve todo sin backfill. ÚNICA
 * excepción: "solo administradores" — si el creador restringe a puros admins,
 * se guardan ids de admin para que la lista quede NO vacía (vacía = "todos");
 * todo no-admin queda excluido y los demás admins siguen viéndolo por la regla.
 *
 * La columna vive en sql/patient-visibility.sql — APLICARLA ANTES del deploy.
 *
 * Este módulo trabaja con un `viewer` mínimo ({ userId, role, clinicId }) a
 * propósito: las rutas de paciente tienen auth heterogénea (getAuthContext,
 * getCurrentUser, loadClinicSession y copias locales de getDbUser) y todas
 * pueden construir ese objeto sin refactor.
 */

/** Lo mínimo que necesitamos de la sesión para decidir visibilidad. */
export interface VisibilityViewer {
  userId: string;
  role: string;
  /** SIEMPRE de la sesión, nunca del body — el aislamiento multi-tenant. */
  clinicId: string;
}

/** Los admins de la clínica ven todo, siempre. */
export function isVisibilityAdmin(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * ¿Este viewer puede ver un paciente con esta lista?
 * Decisión en memoria — para cuando ya tienes `visibleUserIds` a mano y no
 * quieres pagar un query (p.ej. enmascarar la agenda en una sola pasada).
 */
export function canSeePatient(
  viewer: VisibilityViewer,
  visibleUserIds: string[] | null | undefined,
): boolean {
  if (isVisibilityAdmin(viewer.role)) return true;
  // Prisma Client viejo (deploy cacheado) puede no devolver el campo: sin
  // lista conocida NO restringimos — el default histórico es "todos lo ven".
  if (!visibleUserIds || visibleUserIds.length === 0) return true;
  return visibleUserIds.includes(viewer.userId);
}

/**
 * Fragmento de WHERE con la regla PURA de visibleUserIds (sin las heurísticas
 * de doctor de buildPatientWhere). `null` = este viewer no necesita filtro.
 *
 * Devolver `null` para admins en vez de un filtro vacío es intencional: quien
 * lo use puede omitir la condición y dejar el query idéntico al de hoy.
 *
 * Se usa tal cual sobre `patient` (relación) o sobre `patients` (raíz):
 *   const f = patientVisibilityFilter(viewer);
 *   where.AND = f ? [f] : [];
 */
export function patientVisibilityFilter(
  viewer: VisibilityViewer,
): Prisma.PatientWhereInput | null {
  if (isVisibilityAdmin(viewer.role)) return null;
  return {
    OR: [
      { visibleUserIds: { isEmpty: true } }, // sin lista → lo ve todo el equipo
      { visibleUserIds: { has: viewer.userId } }, // en la lista → lo ve
    ],
  };
}

/**
 * Igual que patientVisibilityFilter pero como array, listo para hacer spread
 * dentro de un `AND: [...]`. Vacío para admins.
 *
 * Va en AND (y NUNCA en OR) a propósito: varias rutas ya usan `where.OR` para
 * su búsqueda por texto — meter la visibilidad en OR la pisaría o, peor, la
 * volvería permisiva.
 */
export function patientVisibilityAnd(
  viewer: VisibilityViewer,
): Prisma.PatientWhereInput[] {
  const f = patientVisibilityFilter(viewer);
  return f ? [f] : [];
}

/**
 * Mismo filtro, pero para tablas que se relacionan con Patient (inbox threads,
 * records, etc.). `patientNullable` = true cuando la relación es opcional y las
 * filas SIN paciente deben seguir viéndose (p.ej. hilos de inbox sin paciente).
 */
export function relatedPatientVisibilityAnd(
  viewer: VisibilityViewer,
  opts: { field?: string; patientNullable?: boolean } = {},
): Record<string, any>[] {
  const f = patientVisibilityFilter(viewer);
  if (!f) return [];
  const field = opts.field ?? "patient";
  const branches: Record<string, any>[] = [{ [field]: { is: f } }];
  if (opts.patientNullable) branches.push({ [`${field}Id`]: null });
  return [{ OR: branches }];
}

/**
 * ¿El viewer puede ver ESTE paciente? Un solo query, scopeado por clínica.
 * Devuelve false tanto si el paciente no existe como si no es visible: para
 * quien no puede verlo, el paciente NO existe (404, nunca 403 — un 403
 * confirmaría que el paciente existe).
 */
export async function canViewPatient(
  patientId: string,
  viewer: VisibilityViewer,
): Promise<boolean> {
  if (!patientId) return false;
  const filter = patientVisibilityFilter(viewer);
  const hit = await prisma.patient.findFirst({
    where: {
      id: patientId,
      clinicId: viewer.clinicId, // SIEMPRE de la sesión
      ...(filter ? { AND: [filter] } : {}),
    },
    select: { id: true },
  });
  return hit !== null;
}

/**
 * Guard para rutas: `null` = puede verlo, sigue. Si no, devuelve el 404 listo
 * para retornar.
 *
 *   const denied = await assertPatientVisible(params.id, viewer);
 *   if (denied) return denied;
 */
export async function assertPatientVisible(
  patientId: string,
  viewer: VisibilityViewer,
): Promise<Response | null> {
  const ok = await canViewPatient(patientId, viewer);
  if (ok) return null;
  return new Response(JSON.stringify({ error: "patient_not_found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Normaliza la lista que llega del cliente al crear/editar un paciente:
 *  - solo ids de usuarios ACTIVOS de la MISMA clínica (multi-tenant),
 *  - normalmente sin admins (la regla ya los cubre); EXCEPCIÓN: "solo
 *    administradores" (ver abajo), donde sí se guardan ids de admin para que la
 *    lista no quede vacía,
 *  - sin duplicados,
 *  - auto-incluye al actor si NO es admin: sin esto, un doctor o
 *    recepcionista podría crear un paciente que él mismo no puede ver.
 *
 * Devuelve `[]` SOLO cuando la lista llega vacía → "todos", semántica default.
 * Si el cliente restringió a puros admins (destildó a todo el staff no-admin),
 * devuelve los ids de admin: lista NO vacía = "solo administradores".
 *
 * Lanza si algún id no pertenece a la clínica (mismo patrón que la validación
 * de primaryDoctorId en PATCH /api/patients/[id]).
 */
export async function normalizeVisibleUserIds(
  raw: unknown,
  actor: VisibilityViewer,
): Promise<string[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    throw new Error("visibleUserIds inválido");
  }

  const requested = Array.from(new Set((raw as string[]).map((s) => s.trim()).filter(Boolean)));
  if (requested.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: requested }, clinicId: actor.clinicId, isActive: true },
    select: { id: true, role: true },
  });
  if (users.length !== requested.length) {
    throw new Error("visibleUserIds inválido: usuario fuera de la clínica o inactivo");
  }

  const nonAdminIds = users.filter((u) => !isVisibilityAdmin(u.role)).map((u) => u.id);

  // "Solo administradores": el cliente mandó una lista restringida pero sin
  // ningún no-admin (el creador destildó a todo el staff no-admin). Guardamos
  // los ids de admin para que la lista quede NO vacía (vacía = "todos"): como la
  // regla ya da acceso a CUALQUIER admin, esto excluye a TODO no-admin sin tocar
  // ningún filtro de enforcement (todos usan has(userId) / isEmpty).
  if (nonAdminIds.length === 0) {
    return users.filter((u) => isVisibilityAdmin(u.role)).map((u) => u.id);
  }

  // Auto-inclusión del actor no-admin: sin esto crearía un paciente que él
  // mismo no puede ver.
  if (!isVisibilityAdmin(actor.role) && !nonAdminIds.includes(actor.userId)) {
    nonAdminIds.push(actor.userId);
  }
  return nonAdminIds;
}

/**
 * Auto-inclusión: al asignarle un paciente a un usuario (cita nueva, cambio de
 * doctor, primaryDoctorId), ese usuario DEBE poder verlo — si no, existiría
 * "el doctor atiende a quien no puede ver".
 *
 * No-op cuando la lista está vacía (nadie restringido), cuando el usuario ya
 * está, o cuando es admin (ya ve todo).
 *
 * Devuelve la lista nueva si hubo cambio, o null si no tocó nada — el caller
 * decide si audita.
 */
export async function ensureUserCanSeePatient(
  tx: Prisma.TransactionClient,
  patientId: string,
  userId: string,
  clinicId: string,
): Promise<string[] | null> {
  const patient = await tx.patient.findFirst({
    where: { id: patientId, clinicId },
    select: { visibleUserIds: true },
  });
  if (!patient) return null;

  const current = patient.visibleUserIds ?? [];
  if (current.length === 0) return null; // nadie restringido
  if (current.includes(userId)) return null;

  const user = await tx.user.findFirst({
    where: { id: userId, clinicId },
    select: { role: true },
  });
  if (!user || isVisibilityAdmin(user.role)) return null;

  const next = [...current, userId];
  await tx.patient.update({ where: { id: patientId }, data: { visibleUserIds: next } });
  return next;
}
