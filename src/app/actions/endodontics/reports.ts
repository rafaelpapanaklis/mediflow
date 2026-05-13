"use server";
// Endodontics — server actions de PDFs (referente + legal NOM-024).
// Spec §5.11, §11.1, §11.2.
//
// Reescritura A1 (cierre Endo):
// - Antes devolvían solo { url } stub. Ahora devuelven los datos
//   completos para que el route handler haga renderToBuffer.
// - Patrón idéntico a Orto F7: action carga datos + audita; route
//   handler invoca el template @react-pdf/renderer.

import { prisma } from "@/lib/prisma";
import {
  ENDO_AUDIT_ACTIONS,
  auditEndo,
  fail,
  getEndoActionContext,
  isFailure,
  ok,
  type ActionResult,
} from "./_helpers";

export type ExportPdfResult = { url: string; treatmentId: string };

export type EndoTreatmentReportPdfData = {
  treatmentId: string;
  patient: {
    firstName: string;
    lastName: string;
    dob: Date | null;
    patientNumber: string;
  };
  clinic: { name: string };
  doctor: { firstName: string; lastName: string; cedulaProfesional: string | null };
  diagnosis: {
    pulpalDiagnosis: string;
    periapicalDiagnosis: string;
    diagnosedAt: Date;
    justification: string | null;
  } | null;
  treatment: {
    type: string;
    toothFdi: number;
    startedAt: Date;
    completedAt: Date | null;
    sessionsCount: number;
    isMultiSession: boolean;
    instrumentationSystem: string | null;
    technique: string | null;
    obturationTechnique: string | null;
    sealer: string | null;
    requiresPost: boolean;
    restorationPlan: string | null;
    restorationUrgencyDays: number | null;
    notes: string | null;
  };
  rootCanals: Array<{
    canonicalName: string;
    workingLengthMm: string;
    coronalReferencePoint: string | null;
    masterApicalFileIso: number;
    masterApicalFileTaper: string;
    obturationQuality: string | null;
  }>;
  followUps: Array<{
    milestone: string;
    scheduledAt: Date;
    performedAt: Date | null;
    paiScore: number | null;
    conclusion: string | null;
  }>;
  generatedAt: string;
};

export async function exportTreatmentReportPdf(
  treatmentId: string,
): Promise<ActionResult<EndoTreatmentReportPdfData>> {
  if (!treatmentId) return fail("treatmentId requerido");

  const ctxRes = await getEndoActionContext({ write: false });
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const tx = await prisma.endodonticTreatment.findUnique({
    where: { id: treatmentId },
    include: {
      patient: {
        select: {
          firstName: true,
          lastName: true,
          dob: true,
          patientNumber: true,
        },
      },
      doctor: {
        select: {
          firstName: true,
          lastName: true,
          cedulaProfesional: true,
        },
      },
      diagnosis: {
        select: {
          pulpalDiagnosis: true,
          periapicalDiagnosis: true,
          diagnosedAt: true,
          justification: true,
        },
      },
      rootCanals: { orderBy: { canonicalName: "asc" } },
      followUps: { orderBy: { scheduledAt: "asc" } },
    },
  });
  if (!tx || tx.clinicId !== ctx.clinicId) return fail("Tratamiento no encontrado");

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { name: true },
  });
  if (!clinic) return fail("Clínica no encontrada");

  await auditEndo({
    ctx,
    action: ENDO_AUDIT_ACTIONS.REPORT_TREATMENT_PDF,
    entityType: "endo-treatment",
    entityId: tx.id,
    after: { exportedAt: new Date().toISOString() },
  });

  return ok({
    treatmentId: tx.id,
    patient: tx.patient,
    clinic,
    doctor: tx.doctor,
    diagnosis: tx.diagnosis,
    treatment: {
      type: tx.treatmentType,
      toothFdi: tx.toothFdi,
      startedAt: tx.startedAt,
      completedAt: tx.completedAt,
      sessionsCount: tx.sessionsCount,
      isMultiSession: tx.isMultiSession,
      instrumentationSystem: tx.instrumentationSystem,
      technique: tx.technique,
      obturationTechnique: tx.obturationTechnique,
      sealer: tx.sealer,
      requiresPost: tx.requiresPost,
      restorationPlan: tx.postOpRestorationPlan,
      restorationUrgencyDays: tx.restorationUrgencyDays,
      notes: tx.notes,
    },
    rootCanals: tx.rootCanals.map((c) => ({
      canonicalName: c.canonicalName,
      workingLengthMm: c.workingLengthMm.toString(),
      coronalReferencePoint: c.coronalReferencePoint,
      masterApicalFileIso: c.masterApicalFileIso,
      masterApicalFileTaper: c.masterApicalFileTaper.toString(),
      obturationQuality: c.obturationQuality,
    })),
    followUps: tx.followUps.map((f) => ({
      milestone: f.milestone,
      scheduledAt: f.scheduledAt,
      performedAt: f.performedAt,
      paiScore: f.paiScore,
      conclusion: f.conclusion,
    })),
    generatedAt: new Date().toISOString(),
  });
}

export type EndoLegalReportPdfData = EndoTreatmentReportPdfData & {
  vitalityTests: Array<{
    testType: string;
    toothFdi: number;
    result: string;
    intensity: number | null;
    performedAt: Date;
  }>;
  intracanalMedications: Array<{
    canalName: string | null;
    medication: string;
    placedAt: Date;
    removedAt: Date | null;
  }>;
  retreatmentReason: string | null;
  apicalSurgeryNotes: string | null;
};

export async function exportLegalReportPdf(
  treatmentId: string,
): Promise<ActionResult<EndoLegalReportPdfData>> {
  if (!treatmentId) return fail("treatmentId requerido");

  const ctxRes = await getEndoActionContext({ write: false });
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  // Reusa el loader del informe de referente y agrega lo extra del legal.
  const baseResult = await exportTreatmentReportPdf(treatmentId);
  if (isFailure(baseResult)) return baseResult;

  const tx = await prisma.endodonticTreatment.findUnique({
    where: { id: treatmentId },
    include: {
      patient: { select: { id: true } },
      intracanalMedications: { orderBy: { placedAt: "asc" } },
      retreatmentInfo: { select: { failureReason: true, notes: true } },
      apicalSurgery: { select: { notes: true } },
    },
  });
  if (!tx) return fail("Tratamiento no encontrado");

  const vitalityTests = await prisma.vitalityTest.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId: tx.patientId,
      toothFdi: tx.toothFdi,
    },
    orderBy: { evaluatedAt: "desc" },
    take: 30,
  });

  await auditEndo({
    ctx,
    action: ENDO_AUDIT_ACTIONS.REPORT_LEGAL_PDF,
    entityType: "endo-treatment",
    entityId: tx.id,
    after: { exportedAt: new Date().toISOString(), reportType: "legal" },
  });

  return ok({
    ...baseResult.data,
    vitalityTests: vitalityTests.map((v) => ({
      testType: v.testType,
      toothFdi: v.toothFdi,
      result: v.result,
      intensity: v.intensity,
      performedAt: v.evaluatedAt,
    })),
    intracanalMedications: tx.intracanalMedications.map((m) => ({
      canalName: null,
      medication: m.substance,
      placedAt: m.placedAt,
      removedAt: m.actualRemovalAt,
    })),
    retreatmentReason: tx.retreatmentInfo
      ? `${tx.retreatmentInfo.failureReason.replaceAll("_", " ").toLowerCase()}${tx.retreatmentInfo.notes ? ` — ${tx.retreatmentInfo.notes}` : ""}`
      : null,
    apicalSurgeryNotes: tx.apicalSurgery?.notes ?? null,
  });
}

/**
 * Mantiene compat con cualquier consumer que esperaba `{ url, treatmentId }`.
 * @deprecated Usa `exportTreatmentReportPdf` directo y hidráta el route
 *             handler con renderToBuffer.
 */
export async function getTreatmentReportUrl(
  treatmentId: string,
): Promise<ActionResult<ExportPdfResult>> {
  const r = await exportTreatmentReportPdf(treatmentId);
  if (isFailure(r)) return r;
  return ok({
    treatmentId: r.data.treatmentId,
    url: `/api/endodontics/reports/treatment/${r.data.treatmentId}`,
  });
}
