"use server";
// Implants — createImplant. Spec §5.1, §7.1 paso 3.

import { prisma } from "@/lib/prisma";
import {
  createImplantSchema,
  type CreateImplantInput,
} from "@/lib/validation/implants";
import {
  ODONTOGRAM_STATE_FOR_IMPLANT,
  buildOdontogramNotes,
} from "@/lib/implants/odontogram-sync";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadPatientForImplant,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createImplant(
  input: CreateImplantInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createImplantSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos", parsed.error.issues);
  }

  const ctxRes = await getImplantActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const patientRes = await loadPatientForImplant({
    ctx,
    patientId: parsed.data.patientId,
  });
  if (isFailure(patientRes)) return patientRes;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const implant = await tx.implant.create({
        data: {
          clinicId: ctx.clinicId,
          patientId: parsed.data.patientId,
          toothFdi: parsed.data.toothFdi,
          brand: parsed.data.brand,
          brandCustomName: parsed.data.brandCustomName ?? null,
          modelName: parsed.data.modelName,
          diameterMm: parsed.data.diameterMm,
          lengthMm: parsed.data.lengthMm,
          connectionType: parsed.data.connectionType,
          surfaceTreatment: parsed.data.surfaceTreatment ?? null,
          lotNumber: parsed.data.lotNumber,
          manufactureDate: parsed.data.manufactureDate ?? null,
          expiryDate: parsed.data.expiryDate ?? null,
          placedAt: parsed.data.placedAt,
          placedByDoctorId: parsed.data.placedByDoctorId,
          protocol: parsed.data.protocol,
          currentStatus: parsed.data.initialStatus,
          notes: parsed.data.notes ?? null,
          createdByUserId: ctx.userId,
        },
        select: { id: true, patientId: true },
      });

      // Sincroniza odontograma: marca el diente como IMPLANTE.
      // Spec §8.4. Reusa el modelo OdontogramEntry compartido —
      // surface=null indica que aplica al diente completo.
      const fullToothNotes = buildOdontogramNotes({
        brand: parsed.data.brand,
        modelName: parsed.data.modelName,
        lotNumber: parsed.data.lotNumber,
        currentStatus: parsed.data.initialStatus,
      });
      await tx.odontogramEntry.upsert({
        where: {
          patientId_toothNumber_surface: {
            patientId: parsed.data.patientId,
            toothNumber: parsed.data.toothFdi,
            surface: null as unknown as string,
          },
        },
        update: { state: ODONTOGRAM_STATE_FOR_IMPLANT, notes: fullToothNotes },
        create: {
          patientId: parsed.data.patientId,
          toothNumber: parsed.data.toothFdi,
          surface: null,
          state: ODONTOGRAM_STATE_FOR_IMPLANT,
          notes: fullToothNotes,
        },
      });

      return implant;
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.IMPLANT_CREATED,
      entityType: "implant",
      entityId: created.id,
      after: {
        toothFdi: parsed.data.toothFdi,
        brand: parsed.data.brand,
        modelName: parsed.data.modelName,
        diameterMm: parsed.data.diameterMm,
        lengthMm: parsed.data.lengthMm,
        lotNumber: parsed.data.lotNumber,
        placedAt: parsed.data.placedAt.toISOString(),
        protocol: parsed.data.protocol,
        currentStatus: parsed.data.initialStatus,
      },
    });

    // TODO Phase 8 Item 2 — TreatmentPlan sub-items.
    // El helper `buildSingleImplantPlan({ protocol })` ya genera la
    // secuencia de fases (planeación → cirugía → osteointegración →
    // prótesis → mantenimiento). Pendiente: UI en TreatmentPlan para
    // renderizar `area: "implantology"` con countdown por fase. Cuando
    // exista esa UI, llamar el helper aquí y crear TreatmentSessions
    // (necesita extender el modelo con daysOffset + blockedByPrevious
    // o serializar en notes).

    revalidateImplantPaths({ patientId: created.patientId });
    return ok({ id: created.id });
  } catch (e) {
    console.error("[createImplant]", e);
    return fail("Error al crear implante");
  }
}
