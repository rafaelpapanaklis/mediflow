// Ortodoncia — Cobro (ws1-t1, Ola 1). Contexto propio de ESTE bloque, NO
// `getOrthoActionContext` de `../_helpers.ts`: ese exige `medicalRecord.edit`
// para TODO, dinero incluido — el hallazgo P1 de REPORTE-ws1-t8.md ("Dinero
// con billing.charge; recepción sí, doctor no") que le toca arreglar a
// «Acceso y permisos», no a esta parte. Como este bloque es dinero desde el
// primer archivo, sus propias actions piden la key de `billing.*` que
// corresponda — nunca `medicalRecord.*` — para que recepción (que tiene
// `billing.charge` pero no `medicalRecord.edit`) sí pueda cobrar.
//
// `_helpers.ts` es de «Acceso y permisos» en exclusiva (MAPA DE PARTES,
// REPORTE-ws1-t1.md de la Ola 0): este archivo no lo toca, solo reimplementa
// aquí lo mínimo que Cobro necesita.

import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";
import { canSeePatient } from "@/lib/patient-visibility";
import { fail, type ActionResult } from "../result";

/** Auth + categoría DENTAL + módulo orthodontics activo + permiso de FACTURACIÓN (no clínico). */
export async function getCobroActionContext(permiso: PermissionKey): Promise<ActionResult<{ ctx: AuthContext }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  if (ctx.clinicCategory !== "DENTAL") return fail("La clínica no soporta el módulo de Ortodoncia");
  const access = await canAccessModule(ctx.clinicId, ORTHODONTICS_MODULE_KEY);
  if (!access.hasAccess) return fail("Módulo Ortodoncia no activo para esta clínica");
  if (!hasPermission({ role: ctx.role as any, permissionsOverride: ctx.permissionsOverride }, permiso)) {
    return fail(`Sin permisos: ${permiso}`);
  }
  return { ok: true, data: { ctx } };
}

export interface CasoParaCobro {
  id: string;
  patientId: string;
  invoiceId: string | null;
}

/** Códigos Prisma de "tabla/columna inexistente" — mismo criterio que cobranza-db.ts (Ola 0). */
function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/** Carga el caso, comprobando clínica y visibilidad del paciente (mismo criterio que loadPatientForOrtho). */
export async function loadCasoParaCobro(args: {
  ctx: AuthContext;
  treatmentPlanId: string;
}): Promise<ActionResult<CasoParaCobro>> {
  let plan;
  try {
    plan = await prisma.orthodonticTreatmentPlan.findFirst({
      where: { id: args.treatmentPlanId, clinicId: args.ctx.clinicId, deletedAt: null },
      select: { id: true, patientId: true, invoiceId: true, patient: { select: { visibleUserIds: true } } },
    });
  } catch (e) {
    if (esRelacionAusente(e)) return fail("El núcleo de ortodoncia (Ola 0) todavía no está aplicado en esta base");
    throw e;
  }
  if (!plan) return fail("Caso no encontrado");
  if (!canSeePatient({ userId: args.ctx.userId, role: args.ctx.role, clinicId: args.ctx.clinicId }, plan.patient?.visibleUserIds)) {
    return fail("Caso no encontrado");
  }
  return { ok: true, data: { id: plan.id, patientId: plan.patientId, invoiceId: plan.invoiceId } };
}

/**
 * Bitácora de Cobro. Copia deliberada, minimalista, de `auditOrtho`
 * (`../_helpers.ts`, exclusivo de «Acceso y permisos»): mismo `AuditLog`,
 * mismo criterio de "nunca lanza, falla en silencio con log". No la
 * reexporta ni la modifica esta parte, solo la vuelve a escribir aquí.
 */
export async function auditarCobro(args: {
  ctx: AuthContext;
  action: string;
  entityId: string;
  meta: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        clinicId: args.ctx.clinicId,
        userId: args.ctx.userId,
        entityType: "orthodontic_cobro",
        entityId: args.entityId,
        action: args.action,
        changes: { _meta: args.meta } as object,
      },
    });
  } catch (e) {
    console.error("[ortho cobro audit] failed:", e);
  }
}
