"use server";
// Clinical-shared — server action exportModulePdf({patientId, module, fromDate, toDate}).
// Devuelve un data: URL listo para descargar/imprimir.

import { z } from "zod";
import { renderToStream } from "@react-pdf/renderer";
import { ClinicalModule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { auditClinicalShared, guardPatient } from "@/lib/clinical-shared/auth/guard";
import { fail, isFailure, ok, type ActionResult } from "@/lib/clinical-shared/result";
import { PediatricsExportDocument } from "@/lib/pdf/pediatrics-export-document";

const moduleEnum = z.nativeEnum(ClinicalModule);

const exportSchema = z.object({
  patientId: z.string().min(1),
  module: moduleEnum,
  fromDate: z.string().datetime().optional().nullable(),
  toDate: z.string().datetime().optional().nullable(),
});

export type ExportModulePdfInput = z.infer<typeof exportSchema>;

export async function exportModulePdf(
  input: ExportModulePdfInput,
): Promise<ActionResult<{ pdfUrl: string }>> {
  const parsed = exportSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);

  if (parsed.data.module !== "pediatrics") {
    return fail("Por ahora sólo Pediatría tiene exportación. Otros módulos: TODO.");
  }

  const pdfUrl = await renderPediatricsPdf({
    patientId: parsed.data.patientId,
    clinicId: ctx.clinicId,
    fromDate: parsed.data.fromDate ? new Date(parsed.data.fromDate) : null,
    toDate: parsed.data.toDate ? new Date(parsed.data.toDate) : null,
    doctorName: `${ctx.user.firstName} ${ctx.user.lastName}`,
  });

  await auditClinicalShared({
    ctx,
    action: "clinical-shared.export-module.pdf",
    entityType: "patient",
    entityId: parsed.data.patientId,
    changes: { module: parsed.data.module },
  });

  return ok({ pdfUrl });
}

async function renderPediatricsPdf(args: {
  patientId: string;
  clinicId: string;
  fromDate: Date | null;
  toDate: Date | null;
  doctorName: string;
}): Promise<string> {
  const dateFilter =
    args.fromDate || args.toDate
      ? {
          ...(args.fromDate ? { gte: args.fromDate } : {}),
          ...(args.toDate ? { lte: args.toDate } : {}),
        }
      : undefined;

  const [patient, clinic, eruption, cambra, behavior, sealants, fluorides, habits, consents, photos] =
    await Promise.all([
      prisma.patient.findUnique({
        where: { id: args.patientId },
        select: { firstName: true, lastName: true, dob: true, gender: true },
      }),
      prisma.clinic.findUnique({
        where: { id: args.clinicId },
        select: { name: true },
      }),
      prisma.eruptionRecord.findMany({
        where: {
          patientId: args.patientId,
          clinicId: args.clinicId,
          deletedAt: null,
          ...(dateFilter ? { observedAt: dateFilter } : {}),
        },
        orderBy: { observedAt: "asc" },
        select: {
          toothFdi: true,
          observedAt: true,
          ageAtEruptionDecimal: true,
          withinExpectedRange: true,
          deviation: true,
        },
      }),
      prisma.cariesRiskAssessment.findMany({
        where: {
          patientId: args.patientId,
          clinicId: args.clinicId,
          deletedAt: null,
          ...(dateFilter ? { scoredAt: dateFilter } : {}),
        },
        orderBy: { scoredAt: "asc" },
        select: { scoredAt: true, category: true, recommendedRecallMonths: true },
      }),
      prisma.behaviorAssessment.findMany({
        where: {
          patientId: args.patientId,
          clinicId: args.clinicId,
          deletedAt: null,
          ...(dateFilter ? { recordedAt: dateFilter } : {}),
        },
        orderBy: { recordedAt: "asc" },
        select: { recordedAt: true, scale: true, value: true, notes: true },
      }),
      prisma.sealant.findMany({
        where: {
          patientId: args.patientId,
          clinicId: args.clinicId,
          deletedAt: null,
          ...(dateFilter ? { placedAt: dateFilter } : {}),
        },
        orderBy: { placedAt: "asc" },
        select: {
          toothFdi: true,
          placedAt: true,
          material: true,
          retentionStatus: true,
          reappliedAt: true,
        },
      }),
      prisma.fluorideApplication.findMany({
        where: {
          patientId: args.patientId,
          clinicId: args.clinicId,
          deletedAt: null,
          ...(dateFilter ? { appliedAt: dateFilter } : {}),
        },
        orderBy: { appliedAt: "asc" },
        select: { appliedAt: true, product: true, appliedTeeth: true, lotNumber: true },
      }),
      prisma.oralHabit.findMany({
        where: {
          patientId: args.patientId,
          clinicId: args.clinicId,
          deletedAt: null,
        },
        orderBy: { startedAt: "asc" },
        select: { habitType: true, frequency: true, startedAt: true, endedAt: true },
      }),
      prisma.pediatricConsent.findMany({
        where: {
          patientId: args.patientId,
          clinicId: args.clinicId,
        },
        orderBy: { createdAt: "asc" },
        select: { procedureType: true, guardianSignedAt: true, expiresAt: true },
      }),
      prisma.clinicalPhoto.findMany({
        where: {
          patientId: args.patientId,
          clinicId: args.clinicId,
          module: "pediatrics",
          deletedAt: null,
          ...(dateFilter ? { capturedAt: dateFilter } : {}),
        },
        orderBy: { capturedAt: "asc" },
        select: { photoType: true, stage: true, capturedAt: true },
      }),
    ]);

  if (!patient || !clinic) throw new Error("Paciente o clínica no encontrada");

  const stream = await renderToStream(
    PediatricsExportDocument({
      clinicName: clinic.name,
      doctorName: args.doctorName,
      generatedAt: new Date().toISOString(),
      patientName: `${patient.firstName} ${patient.lastName}`,
      patientDob: patient.dob ? patient.dob.toISOString() : null,
      patientGender: patient.gender ?? null,
      fromDate: args.fromDate ? args.fromDate.toISOString() : null,
      toDate: args.toDate ? args.toDate.toISOString() : null,
      eruption: eruption.map((r) => ({
        toothFdi: r.toothFdi,
        observedAt: r.observedAt.toISOString(),
        ageDecimal: r.ageAtEruptionDecimal.toString(),
        withinExpectedRange: r.withinExpectedRange,
        deviation: r.deviation,
      })),
      cambra: cambra.map((r) => ({
        scoredAt: r.scoredAt.toISOString(),
        category: r.category,
        recallMonths: r.recommendedRecallMonths,
      })),
      behavior: behavior.map((r) => ({
        recordedAt: r.recordedAt.toISOString(),
        scale: r.scale,
        value: r.value,
        notes: r.notes,
      })),
      sealants: sealants.map((r) => ({
        toothFdi: r.toothFdi,
        placedAt: r.placedAt.toISOString(),
        material: r.material,
        retentionStatus: r.retentionStatus,
        reappliedAt: r.reappliedAt ? r.reappliedAt.toISOString() : null,
      })),
      fluorides: fluorides.map((r) => ({
        appliedAt: r.appliedAt.toISOString(),
        product: r.product,
        teethCount: Array.isArray(r.appliedTeeth) ? r.appliedTeeth.length : 0,
        lotNumber: r.lotNumber,
      })),
      habits: habits.map((r) => ({
        habitType: r.habitType,
        frequency: r.frequency,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt ? r.endedAt.toISOString() : null,
      })),
      consents: consents.map((r) => ({
        procedureType: r.procedureType,
        guardianSignedAt: r.guardianSignedAt ? r.guardianSignedAt.toISOString() : null,
        expiresAt: r.expiresAt.toISOString(),
      })),
      photos: photos.map((r) => ({
        photoType: r.photoType,
        stage: r.stage,
        capturedAt: r.capturedAt.toISOString(),
      })),
    }),
  );
  const chunks: Buffer[] = [];
  for await (const c of stream as unknown as AsyncIterable<Buffer>) chunks.push(c);
  return `data:application/pdf;base64,${Buffer.concat(chunks).toString("base64")}`;
}
