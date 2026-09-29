"use server";
// Orthodontics — Ola 1 (ws1-t6), «Alta del caso», A13: carta de avance al
// doctor que refirió al paciente. Dos momentos (`stage`): al iniciar el
// tratamiento y al terminarlo. Mismo patrón que exportTreatmentPlanPdf: esta
// action solo carga y valida los datos; el route handler arma el PDF con
// @react-pdf/renderer (no puppeteer). Sin envío automático — el botón que la
// dispara solo descarga/abre el PDF (ver DrawerCaseSettings).

import { prisma } from "@/lib/prisma";
import { cargarNombreDeTecnica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { canViewPatient } from "@/lib/patient-visibility";
import { z } from "zod";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  treatmentPlanId: z.string().min(1),
  stage: z.enum(["inicio", "termino"]),
});

export interface ReferralProgressLetterPdfData {
  stage: "inicio" | "termino";
  patient: { firstName: string; lastName: string };
  clinic: { name: string; phone: string | null; email: string | null };
  treatingDoctor: { firstName: string; lastName: string; cedulaProfesional: string | null } | null;
  referredByDoctor: { fullName: string; clinicName: string | null };
  diagnosis: {
    angleClassRight: string;
    angleClassLeft: string;
    clinicalSummary: string;
  };
  plan: {
    technique: string;
    /** ws1-t10: nombre propio de la técnica de la clínica. */
    techniqueName?: string | null;
    estimatedDurationMonths: number;
    installedAt: string | null;
    retentionPlanText: string;
    status: string;
  };
  generatedAt: string;
}

export async function exportReferralProgressLetterPdf(
  input: unknown,
): Promise<ActionResult<ReferralProgressLetterPdfData>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  let plan;
  try {
    plan = await prisma.orthodonticTreatmentPlan.findFirst({
      where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
      include: {
        patient: { select: { firstName: true, lastName: true } },
        treatingDoctor: { select: { firstName: true, lastName: true, cedulaProfesional: true } },
        diagnosis: {
          select: {
            angleClassRight: true,
            angleClassLeft: true,
            clinicalSummary: true,
            referredByDoctor: { select: { fullName: true, clinicName: true } },
          },
        },
      },
    });
  } catch (e) {
    console.error("[ortho] exportReferralProgressLetterPdf: columnas de alta-caso.sql ausentes:", e);
    return fail(
      "Falta pegar el SQL de esta parte (sql/ortodoncia-alta-caso.sql) para generar la carta de avance",
    );
  }
  if (!plan) return fail("Plan no encontrado");

  if (!(await canViewPatient(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }))) {
    return fail("Paciente no encontrado");
  }

  if (!plan.diagnosis.referredByDoctor) {
    return fail("Este caso no tiene registrado quién refirió al paciente (A13)");
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { name: true, phone: true, email: true },
  });
  if (!clinic) return fail("Clínica no encontrada");

  await auditOrtho({
    ctx,
    action: `ortho.report.referralProgressLetter.${parsed.data.stage}.pdf`,
    entityType: "OrthodonticTreatmentPlan",
    entityId: plan.id,
    meta: { exportedAt: new Date().toISOString(), stage: parsed.data.stage },
  });

  return ok({
    stage: parsed.data.stage,
    patient: plan.patient,
    clinic,
    treatingDoctor: plan.treatingDoctor,
    referredByDoctor: plan.diagnosis.referredByDoctor,
    diagnosis: {
      angleClassRight: plan.diagnosis.angleClassRight,
      angleClassLeft: plan.diagnosis.angleClassLeft,
      clinicalSummary: plan.diagnosis.clinicalSummary,
    },
    plan: {
      technique: plan.technique,
      techniqueName: await cargarNombreDeTecnica(ctx.clinicId, plan.id),
      estimatedDurationMonths: plan.estimatedDurationMonths,
      installedAt: plan.installedAt ? plan.installedAt.toISOString() : null,
      retentionPlanText: plan.retentionPlanText,
      status: plan.status,
    },
    generatedAt: new Date().toISOString(),
  });
}
