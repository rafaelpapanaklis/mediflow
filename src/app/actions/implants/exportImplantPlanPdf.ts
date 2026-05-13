"use server";
// Implants — exportImplantPlanPdf. Spec §9.1.
//
// Carga datos del plan implantológico (paciente + 1+ implantes) para
// que el componente PDF (Fase 7) lo arme. Soporta dos modos:
//   - implantId: plan de un solo implante.
//   - patientId: plan de TODOS los implantes activos del paciente
//     (útil para All-on-4 — Spec §7.2).

import { prisma } from "@/lib/prisma";
import {
  exportImplantPlanSchema,
  type ExportImplantPlanInput,
} from "@/lib/validation/implants";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  loadPatientForImplant,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export type ImplantPlanData = {
  patient: { id: string; firstName: string; lastName: string };
  doctor: {
    id: string;
    firstName: string;
    lastName: string;
    cedulaProfesional: string | null;
  } | null;
  implants: Array<{
    id: string;
    toothFdi: number;
    brand: string;
    modelName: string;
    diameterMm: unknown;
    lengthMm: unknown;
    lotNumber: string;
    placedAt: Date;
    currentStatus: string;
    protocol: string;
  }>;
};

export async function exportImplantPlanPdf(
  input: ExportImplantPlanInput,
): Promise<ActionResult<ImplantPlanData>> {
  const parsed = exportImplantPlanSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }

  const ctxRes = await getImplantActionContext({ write: false });
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  let patientId: string;
  if (parsed.data.implantId) {
    const r = await loadImplantForCtx({
      ctx,
      implantId: parsed.data.implantId,
    });
    if (isFailure(r)) return r;
    patientId = r.data.patientId;
  } else if (parsed.data.patientId) {
    const r = await loadPatientForImplant({
      ctx,
      patientId: parsed.data.patientId,
    });
    if (isFailure(r)) return r;
    patientId = r.data.id;
  } else {
    return fail("Se requiere implantId o patientId");
  }

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      primaryDoctor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          cedulaProfesional: true,
        },
      },
    },
  });
  if (!patient) return fail("Paciente no encontrado");

  const implants = await prisma.implant.findMany({
    where: parsed.data.implantId
      ? { id: parsed.data.implantId, clinicId: ctx.clinicId }
      : {
          patientId,
          clinicId: ctx.clinicId,
          currentStatus: { not: "REMOVED" },
        },
    select: {
      id: true,
      toothFdi: true,
      brand: true,
      modelName: true,
      diameterMm: true,
      lengthMm: true,
      lotNumber: true,
      placedAt: true,
      currentStatus: true,
      protocol: true,
    },
    orderBy: { placedAt: "asc" },
  });

  await auditImplant({
    ctx,
    action: IMPLANT_AUDIT_ACTIONS.REPORT_PLAN_PDF,
    entityType: parsed.data.implantId ? "implant" : "patient",
    entityId: parsed.data.implantId ?? patientId,
  });

  return ok({
    patient: {
      id: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
    },
    doctor: patient.primaryDoctor,
    implants,
  });
}
