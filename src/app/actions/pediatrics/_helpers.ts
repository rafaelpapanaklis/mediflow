// Pediatrics — helpers internos para server actions (auth + audit). Spec: §4.A.9

import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";
import { canSeePediatrics } from "@/lib/pediatrics/permissions";

export { ok, fail, isFailure, type ActionResult, type Success, type Failure } from "./result";
import { ok, fail, type ActionResult } from "./result";

export type LoadedPatient = {
  id: string;
  clinicId: string;
  dob: Date | null;
};

/**
 * Verifica que el paciente exista, pertenezca al clinicId activo, esté
 * activo y elegible para el módulo Pediatría (categoría + módulo + edad).
 * Devuelve `{ ok: false, error }` con string si falla cualquier predicado.
 */
export async function loadPatientForPediatrics(args: {
  ctx: AuthContext;
  patientId: string;
}): Promise<ActionResult<LoadedPatient>> {
  const patient = await prisma.patient.findUnique({
    where: { id: args.patientId },
    select: {
      id: true,
      clinicId: true,
      dob: true,
      deletedAt: true,
    },
  });
  if (!patient || patient.deletedAt) return fail("Paciente no encontrado");
  if (patient.clinicId !== args.ctx.clinicId) return fail("Sin acceso a este paciente");

  const eligible = canSeePediatrics({
    clinicCategory: args.ctx.clinicCategory,
    clinicModules: getClinicModulesFromCtx(args.ctx),
    patientDob: patient.dob,
  });
  if (!eligible) return fail("Módulo Pediatría no disponible");

  return ok({ id: patient.id, clinicId: patient.clinicId, dob: patient.dob });
}

function getClinicModulesFromCtx(ctx: AuthContext): string[] {
  const clinicAny = (ctx.clinic ?? {}) as { modules?: unknown };
  const raw = clinicAny.modules;
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  return [];
}

/**
 * Devuelve el PediatricRecord del paciente; si no existe, lo crea.
 * Garantiza un único registro por paciente (unique en patientId).
 */
export async function ensurePediatricRecord(args: {
  ctx: AuthContext;
  patientId: string;
}): Promise<{ id: string; clinicId: string }> {
  const existing = await prisma.pediatricRecord.findUnique({
    where: { patientId: args.patientId },
    select: { id: true, clinicId: true },
  });
  if (existing) return existing;

  const created = await prisma.pediatricRecord.create({
    data: {
      clinicId: args.ctx.clinicId,
      patientId: args.patientId,
      createdBy: args.ctx.userId,
    },
    select: { id: true, clinicId: true },
  });
  return created;
}

/**
 * Inserta un registro en AuditLog usando una de las acciones del catálogo
 * pediátrico. Nunca lanza — los errores se silencian con console.error,
 * siguiendo el patrón de @/lib/audit.ts. Acepta cualquier string para
 * entityType / action; la tabla los almacena tal cual.
 */
export async function auditPediatric(args: {
  ctx: AuthContext;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        clinicId: args.ctx.clinicId,
        userId: args.ctx.userId,
        entityType: args.entityType,
        entityId: args.entityId,
        action: args.action,
        changes: (args.changes as object | undefined) ?? null,
      },
    });
  } catch (e) {
    console.error("[pediatrics audit] failed:", e);
  }
}
