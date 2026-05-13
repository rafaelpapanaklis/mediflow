"use server";
// Orthodontics — server action que carga la data necesaria para el
// ComparisonPdf. El render del PDF lo hace el route handler en
// /api/orthodontics/treatment-plans/[id]/comparison-pdf (mismo patrón
// que treatment-plan-pdf y financial-agreement-pdf).

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";
import {
  PHOTO_VIEW_ORDER,
  VIEW_TO_COLUMN,
} from "@/lib/orthodontics/photo-set-helpers";
import type {
  ComparisonPdfData,
  ComparisonPdfPhotoSet,
} from "@/lib/orthodontics/pdf-templates/comparison-pdf-types";

const schema = z.object({
  treatmentPlanId: z.string().min(1),
});

export async function exportComparisonPdf(
  input: unknown,
): Promise<ActionResult<ComparisonPdfData>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    include: {
      diagnosis: true,
      patient: { select: { firstName: true, lastName: true, dob: true } },
      photoSets: {
        orderBy: { capturedAt: "asc" },
        include: {
          photoFrontal: true,
          photoProfile: true,
          photoSmile: true,
          photoIntraFrontal: true,
          photoIntraLateralR: true,
          photoIntraLateralL: true,
          photoOcclusalUpper: true,
          photoOcclusalLower: true,
        },
      },
    },
  });
  if (!plan) return fail("Plan no encontrado");

  const doctor = await prisma.user.findUnique({
    where: { id: plan.diagnosis.diagnosedById },
    select: { firstName: true, lastName: true, cedulaProfesional: true },
  });
  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { name: true },
  });
  if (!clinic) return fail("Clínica no encontrada");

  const initialSet = plan.photoSets.find((s) => s.setType === "T0") ?? null;
  const finalSet = plan.photoSets.find((s) => s.setType === "T2") ?? null;
  const midSets = plan.photoSets.filter(
    (s) => s.setType === "T1" || s.setType === "CONTROL",
  );

  const toPdfSet = (
    s: (typeof plan.photoSets)[number] | null,
    labelOverride?: string,
  ): ComparisonPdfPhotoSet | null => {
    if (!s) return null;
    return {
      label:
        labelOverride ??
        `${s.setType} · ${s.capturedAt.toLocaleDateString("es-MX", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}`,
      capturedAtIso: s.capturedAt.toISOString(),
      monthInTreatment: s.monthInTreatment,
      pairs: PHOTO_VIEW_ORDER.map((view) => {
        const col = VIEW_TO_COLUMN[view] as keyof typeof s;
        const file = s[col] as { url?: string | null } | null;
        return { view, url: file?.url ?? null };
      }),
    };
  };

  const installedAt = plan.installedAt ?? plan.startDate;
  const monthsElapsed = installedAt
    ? Math.max(
        0,
        Math.round((Date.now() - installedAt.getTime()) / (30.44 * 24 * 3600 * 1000)),
      )
    : 0;

  const data: ComparisonPdfData = {
    patientName: `${plan.patient.firstName} ${plan.patient.lastName}`,
    patientDobIso: plan.patient.dob ? plan.patient.dob.toISOString() : null,
    doctorName: doctor ? `${doctor.firstName} ${doctor.lastName}` : "—",
    doctorCedula: doctor?.cedulaProfesional ?? null,
    clinicName: clinic.name,
    techniqueLabel: plan.technique.replaceAll("_", " ").toLowerCase(),
    durationMonthsActual: monthsElapsed,
    estimatedDurationMonths: plan.estimatedDurationMonths,
    diagnosisSummary: plan.diagnosis.clinicalSummary,
    retentionPlanText: plan.retentionPlanText,
    initialSet: toPdfSet(initialSet, initialSet ? "Inicio · T0" : undefined),
    midSets: midSets
      .map((s) => toPdfSet(s, `${s.setType} · mes ${s.monthInTreatment ?? "—"}`))
      .filter((s): s is ComparisonPdfPhotoSet => s !== null),
    finalSet: toPdfSet(finalSet, finalSet ? "Final · T2" : undefined),
    generatedAtIso: new Date().toISOString(),
    hasPhotoUseConsent: false,
  };

  await auditOrtho({
    ctx,
    action: "ortho.comparison-pdf.exported",
    entityType: "OrthodonticTreatmentPlan",
    entityId: plan.id,
    after: {
      midSetsCount: data.midSets.length,
      hasInitial: data.initialSet !== null,
      hasFinal: data.finalSet !== null,
    },
  });

  return ok(data);
}
