// Clinical-shared — helpers de auth y tenant check para los modelos
// cross-cutting (ClinicalPhoto, ReferralLetter, LabOrder, etc.). Reutiliza
// el contrato de getAuthContext() y rechaza si el clinicId del recurso
// no coincide con el de la sesión.

import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";
import { fail, ok, type ActionResult } from "@/lib/clinical-shared/result";

export type ClinicalShareModule =
  | "pediatrics"
  | "endodontics"
  | "periodontics"
  | "implants"
  | "orthodontics";

const ELIGIBLE_CLINIC_CATEGORIES = new Set(["DENTAL", "MEDICINE"]);

/**
 * Verifica que el paciente exista, no esté soft-deleted y pertenezca al
 * clinicId de la sesión. No valida el módulo (cross-cutting): cualquier
 * paciente del clinicId puede tener fotos/órdenes/referencias.
 */
export async function guardPatient(args: {
  ctx: AuthContext;
  patientId: string;
}): Promise<ActionResult<{ id: string; clinicId: string }>> {
  if (!ELIGIBLE_CLINIC_CATEGORIES.has(args.ctx.clinicCategory)) {
    return fail("Categoría de clínica no soportada");
  }
  const patient = await prisma.patient.findUnique({
    where: { id: args.patientId },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!patient || patient.deletedAt) {
    return fail("Paciente no encontrado");
  }
  if (patient.clinicId !== args.ctx.clinicId) {
    return fail("Sin acceso a este paciente");
  }
  return ok({ id: patient.id, clinicId: patient.clinicId });
}

/**
 * Inserta un AuditLog. Nunca lanza — silencia errores con console.error
 * para no romper la action principal (mismo patrón que pediatrics/_helpers).
 */
export async function auditClinicalShared(args: {
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
    console.error("[clinical-shared audit] failed:", e);
  }
}
