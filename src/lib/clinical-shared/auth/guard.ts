// Clinical-shared — helpers de auth y tenant check para los modelos
// cross-cutting (ClinicalPhoto, ReferralLetter, LabOrder, etc.). Reutiliza
// el contrato de getAuthContext() y rechaza si el clinicId del recurso
// no coincide con el de la sesión.

import { prisma } from "@/lib/prisma";
import { anotarFilaDeModulo } from "@/lib/movimientos-paciente/modulos";
import type { AuthContext } from "@/lib/auth-context";
import { fail, ok, type ActionResult, type Failure } from "@/lib/clinical-shared/result";
import { canSeePatient } from "@/lib/patient-visibility";
import {
  mensajeSinPermisoClinico,
  permisosClinicosFaltantes,
  type ModoClinico,
} from "@/lib/auth/guardia-clinica";

export type ClinicalShareModule =
  | "pediatrics"
  | "endodontics"
  | "periodontics"
  | "implants"
  | "orthodontics";

const ELIGIBLE_CLINIC_CATEGORIES = new Set(["DENTAL", "MEDICINE"]);

/**
 * M6 (auditoría 30-sep): permiso de rol de lo clínico para las acciones de
 * clinical-shared. Antes solo se comprobaba clínica y visibilidad del paciente,
 * y recepción o solo lectura exportaban el PDF del módulo, subían o borraban
 * fotos clínicas y creaban enlaces públicos del expediente. Decide el guardia
 * compartido (@/lib/auth/guardia-clinica), con el override por persona.
 * `null` = puede; si no, el Failure listo para devolver.
 */
export function sinPermisoClinico(ctx: AuthContext, modo: ModoClinico): Failure | null {
  const faltan = permisosClinicosFaltantes(ctx, modo);
  return faltan.length === 0 ? null : fail(mensajeSinPermisoClinico(faltan));
}

/**
 * Verifica que el paciente exista, no esté soft-deleted y pertenezca al
 * clinicId de la sesión. No valida el módulo (cross-cutting): cualquier
 * paciente del clinicId puede tener fotos/órdenes/referencias.
 *
 * M6: además pide el permiso clínico. `modo` por omisión es "ver" (lo mínimo
 * para tocar a un paciente desde aquí); las acciones que escriben piden
 * "editar" explícitamente antes de llegar (sinPermisoClinico).
 */
export async function guardPatient(args: {
  ctx: AuthContext;
  patientId: string;
  modo?: ModoClinico;
}): Promise<ActionResult<{ id: string; clinicId: string }>> {
  const sinPermiso = sinPermisoClinico(args.ctx, args.modo ?? "ver");
  if (sinPermiso) return sinPermiso;
  if (!ELIGIBLE_CLINIC_CATEGORIES.has(args.ctx.clinicCategory)) {
    return fail("Categoría de clínica no soportada");
  }
  const patient = await prisma.patient.findUnique({
    where: { id: args.patientId },
    select: { id: true, clinicId: true, deletedAt: true, visibleUserIds: true },
  });
  if (!patient || patient.deletedAt) {
    return fail("Paciente no encontrado");
  }
  if (patient.clinicId !== args.ctx.clinicId) {
    return fail("Sin acceso a este paciente");
  }
  // Visibilidad por paciente (visibleUserIds, ver @/lib/patient-visibility): si el
  // paciente está restringido y este usuario NO está en la lista (ni es admin),
  // para él el paciente NO existe. Mismo mensaje que "no encontrado" — jamás
  // revelar existencia. Centralizarlo aquí cierra de un tiro TODOS los callers de
  // guardPatient: fotos clínicas (ficha v3), export-module, share-links,
  // reminders, referrals, lab-orders — sin un assert por cada uno.
  if (
    !canSeePatient(
      { userId: args.ctx.userId, role: args.ctx.role, clinicId: args.ctx.clinicId },
      (patient as { visibleUserIds?: string[] }).visibleUserIds,
    )
  ) {
    return fail("Paciente no encontrado");
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
  /** ws1-t12 — paciente al que pertenece el cambio (movimientos del paciente). */
  patientId?: string | null;
  changes?: Record<string, unknown>;
}): Promise<void> {
  try {
    await anotarFilaDeModulo({
      clinicId: args.ctx.clinicId,
      userId: args.ctx.userId,
      entityType: args.entityType,
      entityId: args.entityId,
      action: args.action,
      changes: (args.changes as Record<string, unknown> | undefined) ?? null,
      patientId: args.patientId,
    });
  } catch (e) {
    console.error("[clinical-shared audit] failed:", e);
  }
}
