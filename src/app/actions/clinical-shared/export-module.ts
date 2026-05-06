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
import {
  EndodonticsExportDocument,
  type EndoExportRadiograph,
} from "@/lib/pdf/endodontics-export-document";

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

  const renderArgs = {
    patientId: parsed.data.patientId,
    clinicId: ctx.clinicId,
    fromDate: parsed.data.fromDate ? new Date(parsed.data.fromDate) : null,
    toDate: parsed.data.toDate ? new Date(parsed.data.toDate) : null,
    doctorName: `${ctx.user.firstName} ${ctx.user.lastName}`,
  };

  let pdfUrl: string;
  if (parsed.data.module === "pediatrics") {
    pdfUrl = await renderPediatricsPdf(renderArgs);
  } else if (parsed.data.module === "endodontics") {
    pdfUrl = await renderEndodonticsPdf(renderArgs);
  } else {
    return fail(
      `Exportación PDF para ${parsed.data.module} aún no implementada. Pediatría y Endodoncia disponibles.`,
    );
  }

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

async function renderEndodonticsPdf(args: {
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

  const [patient, clinic, diagnoses, vitalityTests, treatments, photos] = await Promise.all([
    prisma.patient.findUnique({
      where: { id: args.patientId },
      select: { firstName: true, lastName: true, dob: true, patientNumber: true },
    }),
    prisma.clinic.findUnique({ where: { id: args.clinicId }, select: { name: true } }),
    prisma.endodonticDiagnosis.findMany({
      where: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        deletedAt: null,
        ...(dateFilter ? { diagnosedAt: dateFilter } : {}),
      },
      orderBy: { diagnosedAt: "desc" },
      select: {
        toothFdi: true,
        pulpalDiagnosis: true,
        periapicalDiagnosis: true,
        justification: true,
        diagnosedAt: true,
      },
    }),
    prisma.vitalityTest.findMany({
      where: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        deletedAt: null,
        ...(dateFilter ? { evaluatedAt: dateFilter } : {}),
      },
      orderBy: { evaluatedAt: "desc" },
      take: 30,
      select: {
        toothFdi: true,
        testType: true,
        result: true,
        evaluatedAt: true,
        notes: true,
      },
    }),
    prisma.endodonticTreatment.findMany({
      where: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        deletedAt: null,
        ...(dateFilter ? { startedAt: dateFilter } : {}),
      },
      orderBy: { startedAt: "desc" },
      include: {
        rootCanals: {
          orderBy: { canonicalName: "asc" },
          include: {
            conductometryFile: {
              select: {
                id: true,
                name: true,
                category: true,
                takenAt: true,
              },
            },
          },
        },
        followUps: {
          orderBy: { scheduledAt: "asc" },
          include: {
            controlFile: {
              select: { id: true, name: true, category: true, takenAt: true },
            },
          },
        },
        apicalSurgery: {
          include: {
            intraoperativeFile: {
              select: { id: true, name: true, category: true, takenAt: true },
            },
          },
        },
      },
    }),
    prisma.clinicalPhoto.findMany({
      where: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        module: "endodontics",
        deletedAt: null,
        ...(dateFilter ? { capturedAt: dateFilter } : {}),
      },
      orderBy: { capturedAt: "asc" },
      select: { photoType: true, stage: true, capturedAt: true, toothFdi: true },
    }),
  ]);

  if (!patient || !clinic) throw new Error("Paciente o clínica no encontrada");

  const radiographs: EndoExportRadiograph[] = [];
  for (const t of treatments) {
    for (const rc of t.rootCanals) {
      if (rc.conductometryFile) {
        radiographs.push({
          fileName: rc.conductometryFile.name,
          category: rc.conductometryFile.category,
          takenAt: rc.conductometryFile.takenAt
            ? rc.conductometryFile.takenAt.toISOString()
            : null,
          source: "conductometry",
          milestone: `Conductometría · pieza ${t.toothFdi} · ${rc.canonicalName}`,
        });
      }
    }
    for (const f of t.followUps) {
      if (f.controlFile) {
        radiographs.push({
          fileName: f.controlFile.name,
          category: f.controlFile.category,
          takenAt: f.controlFile.takenAt ? f.controlFile.takenAt.toISOString() : null,
          source: "control",
          milestone: `${f.milestone} · pieza ${t.toothFdi}`,
        });
      }
    }
    if (t.apicalSurgery?.intraoperativeFile) {
      radiographs.push({
        fileName: t.apicalSurgery.intraoperativeFile.name,
        category: t.apicalSurgery.intraoperativeFile.category,
        takenAt: t.apicalSurgery.intraoperativeFile.takenAt
          ? t.apicalSurgery.intraoperativeFile.takenAt.toISOString()
          : null,
        source: "intraoperative",
        milestone: `Cirugía apical · pieza ${t.toothFdi}`,
      });
    }
  }

  const stream = await renderToStream(
    EndodonticsExportDocument({
      clinicName: clinic.name,
      doctorName: args.doctorName,
      generatedAt: new Date().toISOString(),
      patientName: `${patient.firstName} ${patient.lastName}`,
      patientNumber: patient.patientNumber,
      patientDob: patient.dob ? patient.dob.toISOString() : null,
      fromDate: args.fromDate ? args.fromDate.toISOString() : null,
      toDate: args.toDate ? args.toDate.toISOString() : null,
      toothFdi: null,
      diagnoses: diagnoses.map((d) => ({
        toothFdi: d.toothFdi,
        pulpalDiagnosis: d.pulpalDiagnosis,
        periapicalDiagnosis: d.periapicalDiagnosis,
        justification: d.justification,
        diagnosedAt: d.diagnosedAt.toISOString(),
      })),
      vitalityTests: vitalityTests.map((v) => ({
        toothFdi: v.toothFdi,
        testType: v.testType,
        result: v.result,
        evaluatedAt: v.evaluatedAt.toISOString(),
        notes: v.notes,
      })),
      treatments: treatments.map((t) => ({
        toothFdi: t.toothFdi,
        treatmentType: t.treatmentType,
        startedAt: t.startedAt.toISOString(),
        completedAt: t.completedAt ? t.completedAt.toISOString() : null,
        instrumentationSystem: t.instrumentationSystem,
        technique: t.technique,
        obturationTechnique: t.obturationTechnique,
        sealer: t.sealer,
        notes: t.notes,
        rootCanals: t.rootCanals.map((rc) => ({
          canonicalName: rc.canonicalName,
          workingLengthMm: rc.workingLengthMm.toString(),
          masterApicalFileIso: rc.masterApicalFileIso,
          masterApicalFileTaper: rc.masterApicalFileTaper.toString(),
          obturationQuality: rc.obturationQuality,
        })),
        followUps: t.followUps.map((f) => ({
          milestone: f.milestone,
          scheduledAt: f.scheduledAt.toISOString(),
          performedAt: f.performedAt ? f.performedAt.toISOString() : null,
          paiScore: f.paiScore,
          conclusion: f.conclusion,
        })),
      })),
      photos: photos.map((p) => ({
        photoType: p.photoType,
        stage: p.stage,
        capturedAt: p.capturedAt.toISOString(),
        toothFdi: p.toothFdi,
      })),
      radiographs,
    }),
  );
  const chunks: Buffer[] = [];
  for await (const c of stream as unknown as AsyncIterable<Buffer>) chunks.push(c);
  return `data:application/pdf;base64,${Buffer.concat(chunks).toString("base64")}`;
}
