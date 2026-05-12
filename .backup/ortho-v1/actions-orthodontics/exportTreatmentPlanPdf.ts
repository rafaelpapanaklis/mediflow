"use server";
// Orthodontics — action 14/15: exportTreatmentPlanPdf. SPEC §9.1.
// Carga datos para que el route handler renderToBuffer arme el PDF.

import { prisma } from "@/lib/prisma";
import { exportTreatmentPlanPdfSchema } from "@/lib/validation/orthodontics";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export type TreatmentPlanPdfData = {
  treatmentPlanId: string;
  patient: { firstName: string; lastName: string; dob: Date | null };
  clinic: { name: string };
  doctor: { firstName: string; lastName: string; cedulaProfesional: string | null };
  diagnosis: {
    angleClassRight: string;
    angleClassLeft: string;
    overbiteMm: string;
    overjetMm: string;
    clinicalSummary: string;
  };
  plan: {
    technique: string;
    techniqueNotes: string | null;
    estimatedDurationMonths: number;
    totalCostMxn: string;
    anchorageType: string;
    extractionsRequired: boolean;
    extractionsTeethFdi: number[];
    treatmentObjectives: string;
    retentionPlanText: string;
  };
  phases: Array<{ phaseKey: string; orderIndex: number; status: string }>;
  generatedAt: string;
};

export async function exportTreatmentPlanPdf(
  input: unknown,
): Promise<ActionResult<TreatmentPlanPdfData>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = exportTreatmentPlanPdfSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    include: {
      patient: { select: { firstName: true, lastName: true, dob: true } },
      diagnosis: {
        select: {
          angleClassRight: true,
          angleClassLeft: true,
          overbiteMm: true,
          overjetMm: true,
          clinicalSummary: true,
          diagnosedById: true,
        },
      },
      phases: {
        orderBy: { orderIndex: "asc" },
        select: { phaseKey: true, orderIndex: true, status: true },
      },
    },
  });
  if (!plan) return fail("Plan no encontrado");

  const [clinic, doctor] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { name: true },
    }),
    prisma.user.findUnique({
      where: { id: plan.diagnosis.diagnosedById },
      select: { firstName: true, lastName: true, cedulaProfesional: true },
    }),
  ]);
  if (!clinic || !doctor) return fail("Datos de clínica/doctor incompletos");

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.REPORT_TREATMENT_PLAN_PDF,
    entityType: "OrthodonticTreatmentPlan",
    entityId: plan.id,
    meta: { exportedAt: new Date().toISOString() },
  });

  return ok({
    treatmentPlanId: plan.id,
    patient: plan.patient,
    clinic,
    doctor,
    diagnosis: {
      angleClassRight: plan.diagnosis.angleClassRight,
      angleClassLeft: plan.diagnosis.angleClassLeft,
      overbiteMm: plan.diagnosis.overbiteMm.toString(),
      overjetMm: plan.diagnosis.overjetMm.toString(),
      clinicalSummary: plan.diagnosis.clinicalSummary,
    },
    plan: {
      technique: plan.technique,
      techniqueNotes: plan.techniqueNotes,
      estimatedDurationMonths: plan.estimatedDurationMonths,
      totalCostMxn: plan.totalCostMxn.toString(),
      anchorageType: plan.anchorageType,
      extractionsRequired: plan.extractionsRequired,
      extractionsTeethFdi: plan.extractionsTeethFdi,
      treatmentObjectives: plan.treatmentObjectives,
      retentionPlanText: plan.retentionPlanText,
    },
    phases: plan.phases,
    generatedAt: new Date().toISOString(),
  });
}
