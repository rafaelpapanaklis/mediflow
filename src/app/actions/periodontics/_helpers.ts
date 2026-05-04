// Periodontics — helpers internos para server actions (auth + audit + module gating). SPEC §5

import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";

export { ok, fail, isFailure, type ActionResult, type Success, type Failure } from "./result";
import { fail, type ActionResult } from "./result";

/**
 * Module key registrado en `modules.key` del marketplace para Periodoncia.
 * Coincide con `prisma/seed.ts` (SEED_MODULES) y `src/lib/specialties/keys.ts`.
 */
export const PERIODONTICS_MODULE_KEY = "periodontics";

/**
 * Resuelve el contexto autenticado y verifica:
 *   1. Usuario logueado.
 *   2. Clínica con módulo `periodontics` activo (canAccessModule).
 *   3. Categoría DENTAL (otros tipos no aplican).
 *
 * Una sola llamada por server action; resto de la lógica usa `ctx`.
 */
export async function getPerioActionContext(): Promise<
  ActionResult<{ ctx: AuthContext }>
> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  if (ctx.clinicCategory !== "DENTAL") {
    return fail("La clínica no soporta el módulo de Periodoncia");
  }

  const access = await canAccessModule(ctx.clinicId, PERIODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    return fail("Módulo Periodoncia no activo para esta clínica");
  }

  return { ok: true, data: { ctx } };
}

/**
 * Verifica que un paciente exista, no esté borrado y pertenezca al clinicId
 * activo. Defensivo aunque RLS lo cubra.
 */
export async function loadPatientForPerio(args: {
  ctx: AuthContext;
  patientId: string;
}): Promise<ActionResult<{ id: string; clinicId: string; dob: Date }>> {
  const patient = await prisma.patient.findUnique({
    where: { id: args.patientId },
    select: { id: true, clinicId: true, deletedAt: true, dob: true },
  });
  if (!patient || patient.deletedAt) return fail("Paciente no encontrado");
  if (patient.clinicId !== args.ctx.clinicId) return fail("Sin acceso a este paciente");
  return {
    ok: true,
    data: { id: patient.id, clinicId: patient.clinicId, dob: patient.dob },
  };
}

/**
 * Inserta un registro de audit log periodontal. Nunca lanza — falla en
 * silencio (con log) para no romper la action principal.
 */
export async function auditPerio(args: {
  ctx: AuthContext;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    let changes: Record<string, unknown> | null = null;
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
    if (args.meta) changes = { ...(changes ?? {}), _meta: args.meta };

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
    console.error("[perio audit] failed:", e);
  }
}

/**
 * Catálogo de acciones de audit log para Periodoncia. Strings estables para
 * que el bot no invente nombres ad-hoc.
 */
export const PERIO_AUDIT_ACTIONS = {
  RECORD_CREATED: "perio.record.created",
  RECORD_UPDATED: "perio.record.updated",
  RECORD_FINALIZED: "perio.record.finalized",
  RECORD_DELETED: "perio.record.deleted",
  SITE_UPSERT: "perio.site.upsert",
  TOOTH_UPSERT: "perio.tooth.upsert",
  SITES_BULK_UPSERT: "perio.sites.bulk.upsert",
  CLASSIFICATION_COMPUTED: "perio.classification.computed",
  CLASSIFICATION_OVERRIDE: "perio.classification.override",
  RECESSION_CREATED: "perio.recession.created",
  RECESSION_UPDATED: "perio.recession.updated",
  PLAN_CREATED: "perio.plan.created",
  PHASE_ADVANCED: "perio.plan.phaseAdvanced",
  SRP_SESSION_CREATED: "perio.srp.created",
  REEVALUATION_CREATED: "perio.reevaluation.created",
  RISK_ASSESSED: "perio.risk.assessed",
  SURGERY_CREATED: "perio.surgery.created",
  PERI_IMPLANT_ASSESSED: "perio.periImplant.assessed",
  CONSENT_SRP_SIGNED: "perio.consent.srp.signed",
  CONSENT_SURGERY_SIGNED: "perio.consent.surgery.signed",
  MAINTENANCE_SCHEDULED: "perio.maintenance.scheduled",
  MAINTENANCE_COMPLETED: "perio.maintenance.completed",
  REPORT_PATIENT_PDF: "perio.report.patient.pdf",
  REPORT_REFERRER_PDF: "perio.report.referrer.pdf",
  REPORT_PRE_POST_PDF: "perio.report.prePost.pdf",
} as const;

export type PerioAuditAction =
  (typeof PERIO_AUDIT_ACTIONS)[keyof typeof PERIO_AUDIT_ACTIONS];
