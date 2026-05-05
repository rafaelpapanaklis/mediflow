"use server";
// Implants — createProstheticPhase. Spec §6.10. Al finalizar
// exitosamente la fase protésica:
//   1. Crea ImplantProstheticPhase.
//   2. Sube currentStatus a LOADED_DEFINITIVE (o LOADED_PROVISIONAL si
//      es prótesis acrílica provisional).
//   3. AUTO-GENERA ImplantPassport (carnet PDF horizontal landscape) —
//      decisión bloqueada §1.15. Mismo transaction para garantizar
//      consistencia.

import { prisma } from "@/lib/prisma";
import {
  createProstheticPhaseSchema,
  type CreateProstheticPhaseInput,
} from "@/lib/validation/implants";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createProstheticPhase(
  input: CreateProstheticPhaseInput,
): Promise<ActionResult<{ id: string; passportId: string }>> {
  const parsed = createProstheticPhaseSchema.safeParse(input);
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
  const before = implantRes.data;

  // Determina nuevo status según prótesis. Provisional acrílica =
  // LOADED_PROVISIONAL; cualquier otra = LOADED_DEFINITIVE.
  const newStatus =
    parsed.data.prosthesisMaterial === "ACRYLIC_PROVISIONAL" ||
    parsed.data.prosthesisMaterial === "PMMA_PROVISIONAL" ||
    parsed.data.prosthesisType === "PROVISIONAL_ACRYLIC"
      ? ("LOADED_PROVISIONAL" as const)
      : ("LOADED_DEFINITIVE" as const);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const phase = await tx.implantProstheticPhase.create({
        data: {
          implantId: parsed.data.implantId,
          abutmentType: parsed.data.abutmentType,
          abutmentBrand: parsed.data.abutmentBrand ?? null,
          abutmentLot: parsed.data.abutmentLot,
          abutmentDiameterMm: parsed.data.abutmentDiameterMm ?? null,
          abutmentHeightMm: parsed.data.abutmentHeightMm ?? null,
          abutmentAngulationDeg: parsed.data.abutmentAngulationDeg ?? null,
          abutmentTorqueNcm: parsed.data.abutmentTorqueNcm,
          prosthesisType: parsed.data.prosthesisType,
          prosthesisMaterial: parsed.data.prosthesisMaterial,
          prosthesisLabName: parsed.data.prosthesisLabName,
          prosthesisLabLot: parsed.data.prosthesisLabLot,
          screwLot: parsed.data.screwLot ?? null,
          screwTorqueNcm: parsed.data.screwTorqueNcm ?? null,
          immediateLoading: parsed.data.immediateLoading,
          provisionalDeliveredAt: parsed.data.provisionalDeliveredAt ?? null,
          definitiveDeliveredAt: parsed.data.definitiveDeliveredAt ?? null,
          prosthesisDeliveredAt: parsed.data.prosthesisDeliveredAt,
          occlusionScheme: parsed.data.occlusionScheme ?? null,
          notes: parsed.data.notes ?? null,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });

      await tx.implant.update({
        where: { id: parsed.data.implantId },
        data: {
          currentStatus: newStatus,
          statusUpdatedAt: new Date(),
        },
      });

      // Auto-genera carnet (Spec §1.15). Si ya existe (re-ejecución del
      // wizard), actualiza regeneratedAt en lugar de duplicar.
      const existingPassport = await tx.implantPassport.findUnique({
        where: { implantId: parsed.data.implantId },
        select: { id: true },
      });
      let passportId: string;
      if (existingPassport) {
        const updated = await tx.implantPassport.update({
          where: { id: existingPassport.id },
          data: { regeneratedAt: new Date() },
          select: { id: true },
        });
        passportId = updated.id;
      } else {
        const created = await tx.implantPassport.create({
          data: {
            implantId: parsed.data.implantId,
            createdByUserId: ctx.userId,
          },
          select: { id: true },
        });
        passportId = created.id;
      }

      return { phaseId: phase.id, passportId };
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.PROSTHETIC_PHASE_CREATED,
      entityType: "implant.prosthetic",
      entityId: result.phaseId,
      after: {
        implantId: parsed.data.implantId,
        prosthesisType: parsed.data.prosthesisType,
        prosthesisMaterial: parsed.data.prosthesisMaterial,
        prosthesisLabLot: parsed.data.prosthesisLabLot,
        abutmentLot: parsed.data.abutmentLot,
      },
    });
    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.IMPLANT_STATUS_CHANGED,
      entityType: "implant",
      entityId: parsed.data.implantId,
      before: { currentStatus: before.currentStatus },
      after: { currentStatus: newStatus },
    });
    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.PASSPORT_GENERATED,
      entityType: "implant.passport",
      entityId: result.passportId,
      after: { implantId: parsed.data.implantId, autoGenerated: true },
    });

    revalidateImplantPaths({ patientId: before.patientId });
    return ok({ id: result.phaseId, passportId: result.passportId });
  } catch (e) {
    console.error("[createProstheticPhase]", e);
    return fail("Error al guardar fase protésica");
  }
}
