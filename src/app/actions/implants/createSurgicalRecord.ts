"use server";
// Implants — createSurgicalRecord. Spec §6.9, §7.1 paso 6.
// Al cerrar la cirugía: crea ImplantSurgicalRecord, sube el status a
// OSSEOINTEGRATING, y crea ImplantHealingPhase con expectedDurationWeeks
// derivado de la densidad ósea (LEKHOLM_ZARB_INFO).

import { prisma } from "@/lib/prisma";
import {
  createSurgicalRecordSchema,
  type CreateSurgicalRecordInput,
} from "@/lib/validation/implants";
import { osseointegrationWeeksFor } from "@/lib/implants/lekholm-zarb";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createSurgicalRecord(
  input: CreateSurgicalRecordInput,
): Promise<ActionResult<{ id: string; healingPhaseId: string | null }>> {
  const parsed = createSurgicalRecordSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }

  const ctxRes = await getImplantActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const implantRes = await loadImplantForCtx({
    ctx,
    implantId: parsed.data.implantId,
  });
  if (isFailure(implantRes)) return implantRes;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const surgical = await tx.implantSurgicalRecord.create({
        data: {
          implantId: parsed.data.implantId,
          performedAt: parsed.data.performedAt,
          asaClassification: parsed.data.asaClassification,
          prophylaxisAntibiotic: parsed.data.prophylaxisAntibiotic,
          prophylaxisDrug: parsed.data.prophylaxisDrug ?? null,
          hba1cIfDiabetic: parsed.data.hba1cIfDiabetic ?? null,
          insertionTorqueNcm: parsed.data.insertionTorqueNcm,
          isqMesiodistal: parsed.data.isqMesiodistal,
          isqVestibulolingual: parsed.data.isqVestibulolingual,
          boneDensity: parsed.data.boneDensity,
          ridgeWidthMm: parsed.data.ridgeWidthMm ?? null,
          ridgeHeightMm: parsed.data.ridgeHeightMm ?? null,
          flapType: parsed.data.flapType,
          drillingProtocol: parsed.data.drillingProtocol,
          healingAbutmentLot: parsed.data.healingAbutmentLot ?? null,
          healingAbutmentDiameterMm: parsed.data.healingAbutmentDiameterMm ?? null,
          healingAbutmentHeightMm: parsed.data.healingAbutmentHeightMm ?? null,
          sutureMaterial: parsed.data.sutureMaterial ?? null,
          sutureRemovalScheduledAt: parsed.data.sutureRemovalScheduledAt ?? null,
          intraoperativePhotoFileId: parsed.data.intraoperativePhotoFileId ?? null,
          postOpInstructions: parsed.data.postOpInstructions ?? null,
          durationMinutes: parsed.data.durationMinutes,
          complications: parsed.data.complications ?? null,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });

      // Sube status a OSSEOINTEGRATING (Spec §7.1 paso 6).
      await tx.implant.update({
        where: { id: parsed.data.implantId },
        data: {
          currentStatus: "OSSEOINTEGRATING",
          statusUpdatedAt: new Date(),
        },
      });

      // Crea ImplantHealingPhase con weeks por densidad.
      const healing = await tx.implantHealingPhase.create({
        data: {
          implantId: parsed.data.implantId,
          startedAt: parsed.data.performedAt,
          expectedDurationWeeks: osseointegrationWeeksFor(parsed.data.boneDensity),
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });

      return { surgicalId: surgical.id, healingId: healing.id };
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.SURGICAL_RECORD_CREATED,
      entityType: "implant.surgical",
      entityId: result.surgicalId,
      after: {
        implantId: parsed.data.implantId,
        boneDensity: parsed.data.boneDensity,
        torque: parsed.data.insertionTorqueNcm,
        isqMD: parsed.data.isqMesiodistal,
        isqVL: parsed.data.isqVestibulolingual,
      },
    });
    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.HEALING_PHASE_CREATED,
      entityType: "implant.healing",
      entityId: result.healingId,
      after: {
        implantId: parsed.data.implantId,
        expectedDurationWeeks: osseointegrationWeeksFor(parsed.data.boneDensity),
      },
    });
    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.IMPLANT_STATUS_CHANGED,
      entityType: "implant",
      entityId: parsed.data.implantId,
      before: { currentStatus: "PLACED" },
      after: { currentStatus: "OSSEOINTEGRATING" },
    });

    revalidateImplantPaths({ patientId: implantRes.data.patientId });
    return ok({ id: result.surgicalId, healingPhaseId: result.healingId });
  } catch (e) {
    console.error("[createSurgicalRecord]", e);
    return fail("Error al guardar la cirugía");
  }
}
