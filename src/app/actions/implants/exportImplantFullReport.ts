"use server";
// Implants — exportImplantFullReport. Carga el expediente completo del
// implante (planificación, cirugía, cicatrización, segunda fase, prótesis,
// controles, complicaciones, fotos por fase) y devuelve los datos para
// que el route handler genere el PDF con ImplantFullReportDocument.

import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { implantPhotoTypeToImplantPhase } from "@/lib/clinical-shared/photo-gallery";
import type { ImplantFullReportPdfData } from "@/lib/implants/pdf-templates/full-report";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

const exportImplantFullReportSchema = z.object({
  implantId: z.string().min(1),
});

export type ExportImplantFullReportInput = z.infer<
  typeof exportImplantFullReportSchema
>;

function toAge(dob: Date | null): number | null {
  if (!dob) return null;
  const ms = Date.now() - dob.getTime();
  const yrs = Math.floor(ms / (365.25 * 24 * 3600 * 1000));
  return yrs >= 0 && yrs < 150 ? yrs : null;
}

function genderLabel(g: string | null | undefined): string | null {
  if (!g) return null;
  switch (g) {
    case "MALE":
      return "M";
    case "FEMALE":
      return "F";
    default:
      return "Otro";
  }
}

export async function exportImplantFullReport(
  input: ExportImplantFullReportInput,
): Promise<ActionResult<ImplantFullReportPdfData>> {
  const parsed = exportImplantFullReportSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }

  const ctxRes = await getImplantActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const baseRes = await loadImplantForCtx({
    ctx,
    implantId: parsed.data.implantId,
  });
  if (isFailure(baseRes)) return baseRes;

  // Carga relaciones completas
  const implant = await prisma.implant.findUnique({
    where: { id: parsed.data.implantId },
    select: {
      id: true,
      patientId: true,
      toothFdi: true,
      brand: true,
      brandCustomName: true,
      modelName: true,
      diameterMm: true,
      lengthMm: true,
      connectionType: true,
      surfaceTreatment: true,
      lotNumber: true,
      manufactureDate: true,
      expiryDate: true,
      placedAt: true,
      protocol: true,
      currentStatus: true,
      patient: {
        select: {
          firstName: true,
          lastName: true,
          dob: true,
          gender: true,
        },
      },
      placedByDoctor: {
        select: {
          firstName: true,
          lastName: true,
          cedulaProfesional: true,
        },
      },
      clinic: { select: { name: true, phone: true, address: true } },
      surgicalRecord: true,
      healingPhase: true,
      secondStage: true,
      prostheticPhase: true,
      followUps: { orderBy: { performedAt: "asc" } },
      complications: { orderBy: { detectedAt: "asc" } },
    },
  });
  if (!implant) return fail("Implante no encontrado");

  // Fotos del paciente del módulo implants vinculadas vía recordId no
  // existen — el modelo ClinicalPhoto del schema base es por (clinicId,
  // patientId, module). Filtramos por patientId + module=implants.
  const photos = await prisma.clinicalPhoto.findMany({
    where: {
      patientId: implant.patientId,
      module: "implants",
      deletedAt: null,
    },
    orderBy: { capturedAt: "asc" },
    select: {
      id: true,
      photoType: true,
      stage: true,
      blobUrl: true,
      thumbnailUrl: true,
      notes: true,
      capturedAt: true,
    },
  });

  // Agrupar fotos por fase implantológica usando el helper de mapeo
  const phaseGroups: Record<string, typeof photos> = {};
  for (const p of photos) {
    const phase = implantPhotoTypeToImplantPhase(p.photoType);
    (phaseGroups[phase] ??= []).push(p);
  }
  const photosByPhase = Object.entries(phaseGroups).map(([phase, items]) => ({
    phase,
    items: items.map((it) => ({
      url: it.thumbnailUrl ?? it.blobUrl,
      caption: it.notes,
      takenAt: it.capturedAt,
    })),
  }));

  const data: ImplantFullReportPdfData = {
    clinic: {
      name: implant.clinic.name,
      phone: implant.clinic.phone,
      address: implant.clinic.address,
    },
    doctor: {
      firstName: implant.placedByDoctor.firstName,
      lastName: implant.placedByDoctor.lastName,
      cedulaProfesional: implant.placedByDoctor.cedulaProfesional,
    },
    patient: {
      firstName: implant.patient.firstName,
      lastName: implant.patient.lastName,
      age: toAge(implant.patient.dob),
      sex: genderLabel(implant.patient.gender),
    },
    generatedAt: new Date(),
    implant: {
      id: implant.id,
      toothFdi: implant.toothFdi,
      brand: implant.brand,
      brandCustomName: implant.brandCustomName,
      modelName: implant.modelName,
      diameterMm: String(implant.diameterMm),
      lengthMm: String(implant.lengthMm),
      connectionType: implant.connectionType,
      surfaceTreatment: implant.surfaceTreatment,
      lotNumber: implant.lotNumber,
      manufactureDate: implant.manufactureDate,
      expiryDate: implant.expiryDate,
      placedAt: implant.placedAt,
      protocol: implant.protocol,
      currentStatus: implant.currentStatus,
    },
    planning: null, // No hay tabla de planificación separada aún
    surgical: implant.surgicalRecord
      ? {
          performedAt: implant.surgicalRecord.performedAt,
          insertionTorqueNcm: implant.surgicalRecord.insertionTorqueNcm,
          isqMesiodistal: implant.surgicalRecord.isqMesiodistal,
          isqVestibulolingual: implant.surgicalRecord.isqVestibulolingual,
          boneDensity: implant.surgicalRecord.boneDensity,
          flapType: implant.surgicalRecord.flapType,
          drillingProtocol: implant.surgicalRecord.drillingProtocol,
          healingAbutmentLot: implant.surgicalRecord.healingAbutmentLot,
          healingAbutmentDiameterMm:
            implant.surgicalRecord.healingAbutmentDiameterMm
              ? String(implant.surgicalRecord.healingAbutmentDiameterMm)
              : null,
          healingAbutmentHeightMm:
            implant.surgicalRecord.healingAbutmentHeightMm
              ? String(implant.surgicalRecord.healingAbutmentHeightMm)
              : null,
          sutureMaterial: implant.surgicalRecord.sutureMaterial,
          durationMinutes: implant.surgicalRecord.durationMinutes,
          complications: implant.surgicalRecord.complications,
        }
      : null,
    healing: implant.healingPhase
      ? {
          startedAt: implant.healingPhase.startedAt,
          expectedDurationWeeks: implant.healingPhase.expectedDurationWeeks,
          isqLatest: implant.healingPhase.isqLatest,
          isqLatestAt: implant.healingPhase.isqLatestAt,
          completedAt: implant.healingPhase.completedAt,
          notes: implant.healingPhase.notes,
        }
      : null,
    secondStage: implant.secondStage
      ? {
          performedAt: implant.secondStage.performedAt,
          technique: implant.secondStage.technique,
          healingAbutmentLot: implant.secondStage.healingAbutmentLot,
          isqAtUncovering: implant.secondStage.isqAtUncovering,
          durationMinutes: implant.secondStage.durationMinutes,
          notes: implant.secondStage.notes,
        }
      : null,
    prosthetic: implant.prostheticPhase
      ? {
          abutmentType: implant.prostheticPhase.abutmentType,
          abutmentBrand: implant.prostheticPhase.abutmentBrand,
          abutmentLot: implant.prostheticPhase.abutmentLot,
          abutmentTorqueNcm: implant.prostheticPhase.abutmentTorqueNcm,
          prosthesisType: implant.prostheticPhase.prosthesisType,
          prosthesisMaterial: implant.prostheticPhase.prosthesisMaterial,
          prosthesisLabName: implant.prostheticPhase.prosthesisLabName,
          prosthesisLabLot: implant.prostheticPhase.prosthesisLabLot,
          screwLot: implant.prostheticPhase.screwLot,
          screwTorqueNcm: implant.prostheticPhase.screwTorqueNcm,
          occlusionScheme: implant.prostheticPhase.occlusionScheme,
          prosthesisDeliveredAt: implant.prostheticPhase.prosthesisDeliveredAt,
        }
      : null,
    followUps: implant.followUps.map((f) => ({
      milestone: f.milestone,
      performedAt: f.performedAt,
      bopPresent: f.bopPresent,
      pdMaxMm: f.pdMaxMm ? String(f.pdMaxMm) : null,
      radiographicBoneLossMm: f.radiographicBoneLossMm
        ? String(f.radiographicBoneLossMm)
        : null,
      meetsAlbrektssonCriteria: f.meetsAlbrektssonCriteria,
      notes: f.notes,
    })),
    complications: implant.complications.map((c) => ({
      detectedAt: c.detectedAt,
      type: c.type,
      severity: c.severity,
      description: c.description,
      resolvedAt: c.resolvedAt,
      outcome: c.outcome,
    })),
    photosByPhase,
  };

  // Audit
  await auditImplant({
    ctx,
    action: IMPLANT_AUDIT_ACTIONS.REPORT_FULL_PDF,
    entityType: "Implant",
    entityId: implant.id,
    meta: {
      patientId: implant.patientId,
      toothFdi: implant.toothFdi,
      brand: implant.brand,
      lotNumber: implant.lotNumber,
    },
  }).catch(() => {
    /* audit no bloquea la export */
  });

  return ok(data);
}
