// Endodontics — helpers internos para server actions (auth + audit + module gating). Spec §5

import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";

export { ok, fail, isFailure, type ActionResult, type Success, type Failure } from "./result";
import { fail, type ActionResult } from "./result";

/**
 * Module key registrado en `modules.key` del marketplace para Endodoncia.
 * Coincide con prisma/seed.ts (SEED_MODULES).
 */
export const ENDODONTICS_MODULE_KEY = "endodontics";

/**
 * Resuelve el contexto autenticado y verifica:
 *   1. Usuario logueado.
 *   2. Clínica con módulo `endodontics` activo (canAccessModule).
 *   3. Categoría DENTAL (los otros tipos de clínica no aplican).
 *
 * Retorna `{ ok: false, error }` si falla cualquier predicado. Una sola
 * llamada por server action; resto de la lógica usa el `ctx` retornado.
 */
export async function getEndoActionContext(): Promise<
  ActionResult<{ ctx: AuthContext }>
> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  if (ctx.clinicCategory !== "DENTAL") {
    return fail("La clínica no soporta el módulo de Endodoncia");
  }

  const access = await canAccessModule(ctx.clinicId, ENDODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    return fail("Módulo Endodoncia no activo para esta clínica");
  }

  return { ok: true, data: { ctx } };
}

/**
 * Verifica que un paciente exista, no esté borrado y pertenezca al
 * clinicId activo. Defensivo aunque RLS lo cubra. Devuelve solo lo
 * necesario para que las actions puedan armar `revalidatePath`.
 */
export async function loadPatientForEndo(args: {
  ctx: AuthContext;
  patientId: string;
}): Promise<ActionResult<{ id: string; clinicId: string }>> {
  const patient = await prisma.patient.findUnique({
    where: { id: args.patientId },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!patient || patient.deletedAt) return fail("Paciente no encontrado");
  if (patient.clinicId !== args.ctx.clinicId) return fail("Sin acceso a este paciente");
  return { ok: true, data: { id: patient.id, clinicId: patient.clinicId } };
}

/**
 * Inserta un registro de audit log endodóntico. Strings de entity/action
 * son libres (la columna AuditLog acepta texto). Nunca lanza.
 */
export async function auditEndo(args: {
  ctx: AuthContext;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    let changes: Record<string, { before: unknown; after: unknown }> | null = null;
    if (args.before && args.after) {
      changes = {};
      const allKeys = Array.from(
        new Set([...Object.keys(args.before), ...Object.keys(args.after)]),
      );
      for (const key of allKeys) {
        if (["createdAt", "updatedAt", "id"].includes(key)) continue;
        const b = args.before[key];
        const a = args.after[key];
        if (JSON.stringify(b) !== JSON.stringify(a)) {
          changes[key] = { before: b, after: a };
        }
      }
    } else if (args.after && !args.before) {
      changes = { _created: { before: null, after: args.after } };
    } else if (args.before && !args.after) {
      changes = { _deleted: { before: args.before, after: null } };
    }

    await prisma.auditLog.create({
      data: {
        clinicId: args.ctx.clinicId,
        userId: args.ctx.userId,
        entityType: args.entityType,
        entityId: args.entityId,
        action: args.action,
        changes: (changes as object | null) ?? null,
      },
    });
  } catch (e) {
    console.error("[endo audit] failed:", e);
  }
}

/**
 * Catálogo de acciones de audit log para Endodoncia. Se documentan acá
 * para que el bot Git no invente strings ad-hoc.
 */
export const ENDO_AUDIT_ACTIONS = {
  DIAGNOSIS_CREATED: "endo.diagnosis.created",
  DIAGNOSIS_UPDATED: "endo.diagnosis.updated",
  VITALITY_RECORDED: "endo.vitality.recorded",
  TREATMENT_STARTED: "endo.treatment.started",
  TREATMENT_STEP_UPDATED: "endo.treatment.step.updated",
  TREATMENT_COMPLETED: "endo.treatment.completed",
  ROOT_CANAL_UPSERT: "endo.rootCanal.upsert",
  INTRACANAL_MED_RECORDED: "endo.medication.recorded",
  FOLLOWUP_SCHEDULED: "endo.followup.scheduled",
  FOLLOWUP_COMPLETED: "endo.followup.completed",
  RETREATMENT_INFO_CREATED: "endo.retreatment.info.created",
  APICAL_SURGERY_CREATED: "endo.apicalSurgery.created",
  REPORT_TREATMENT_PDF: "endo.report.treatment.pdf",
  REPORT_LEGAL_PDF: "endo.report.legal.pdf",
} as const;

export type EndoAuditAction =
  (typeof ENDO_AUDIT_ACTIONS)[keyof typeof ENDO_AUDIT_ACTIONS];
