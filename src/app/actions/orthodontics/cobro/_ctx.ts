// Ortodoncia — Cobro (ws1-t1, Ola 1). Lo que este bloque necesita PARA SÍ,
// aparte del gate de acceso (que ya no vive aquí — ver abajo).
//
// Revisión cruzada (Ola 1): este archivo tenía su propio `getCobroActionContext`,
// duplicado casi exacto de `getOrthoBillingActionContext` (`../_helpers.ts`,
// «Acceso y permisos») — carrera de 73 segundos entre ambas partes al
// construirse la misma pieza en paralelo sin poder coordinarse en tiempo
// real. Se retiró de aquí: las 8 actions de `cobro/*.ts` ahora importan
// `getOrthoBillingActionContext` directo de `../_helpers`. Este archivo se
// queda solo con lo que sigue siendo EXCLUSIVO de Cobro.

import { prisma } from "@/lib/prisma";
import { cargarNombreDeTecnica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import type { OrthoTechnique } from "@prisma/client";
import type { AuthContext } from "@/lib/auth-context";
import { canSeePatient } from "@/lib/patient-visibility";
import { fail, type ActionResult } from "../result";

export interface CasoParaCobro {
  id: string;
  patientId: string;
  invoiceId: string | null;
  /** ronda 3 (ws1-t2, H9): para precargar «Abrir plan de pago» — concepto, precio y doctor tratante. */
  technique: OrthoTechnique;
  /** ws1-t10: nombre propio de la técnica del caso (null = el del tipo base). */
  techniqueName?: string | null;
  totalCostMxn: number;
  treatingDoctorId: string | null;
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
      select: {
        id: true, patientId: true, invoiceId: true, technique: true, totalCostMxn: true, treatingDoctorId: true,
        patient: { select: { visibleUserIds: true } },
      },
    });
  } catch (e) {
    if (esRelacionAusente(e)) return fail("El núcleo de ortodoncia (Ola 0) todavía no está aplicado en esta base");
    throw e;
  }
  if (!plan) return fail("Caso no encontrado");
  if (!canSeePatient({ userId: args.ctx.userId, role: args.ctx.role, clinicId: args.ctx.clinicId }, plan.patient?.visibleUserIds)) {
    return fail("Caso no encontrado");
  }
  return {
    ok: true,
    data: {
      id: plan.id,
      patientId: plan.patientId,
      invoiceId: plan.invoiceId,
      technique: plan.technique,
      techniqueName: await cargarNombreDeTecnica(args.ctx.clinicId, plan.id),
      totalCostMxn: Number(plan.totalCostMxn) || 0,
      treatingDoctorId: plan.treatingDoctorId,
    },
  };
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
