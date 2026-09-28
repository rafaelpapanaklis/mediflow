"use server";
// Orthodontics — action 4/15: updateTreatmentPlan. SPEC §5.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { updateTreatmentPlanSchema } from "@/lib/validation/orthodontics";
import { isMissingColumnError } from "@/lib/orthodontics/alta-caso-tolerance";
import { auditOrtho, getOrthoPlanActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

// Ola 1 (ws1-t6) — columnas de sql/ortodoncia-alta-caso.sql (A5/A11): si el
// update las toca y aún no existen (P2021/P2022), reintenta sin ellas.
const ALTA_CASO_PLAN_FIELDS = ["treatingDoctorId", "responsibleGuardianId"] as const;

export async function updateTreatmentPlan(
  input: unknown,
): Promise<ActionResult<{ id: string; altaCasoFieldsSaved: boolean }>> {
  // A11 (revisión cruzada): si el payload SOLO trae treatmentPlanId +
  // responsibleGuardianId/newResponsibleGuardian, acepta billing.* además de
  // medicalRecord.edit — recepción arma/cambia quién paga sin necesitar el
  // permiso clínico. Cualquier otro campo (status, técnica…) sigue exigiendo
  // medicalRecord.edit completo, como antes.
  const auth = await getOrthoPlanActionContext(input);
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = updateTreatmentPlanSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const before = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
  });
  if (!before) return fail("Plan no encontrado");

  // Validación específica: si status pasa a DROPPED_OUT, exige droppedOutReason.
  if (parsed.data.status === "DROPPED_OUT") {
    if (!parsed.data.droppedOutReason || parsed.data.droppedOutReason.length < 20) {
      return fail("DROPPED_OUT requiere droppedOutReason ≥20 caracteres");
    }
  }

  const { treatmentPlanId, diagnosisId, patientId, newResponsibleGuardian, ...rest } = parsed.data;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) data[key] = value;
  }
  // `installedAt`/`startDate` viajan como string ISO (schema `.datetime()`);
  // Prisma exige `Date` en `update()`. Nadie más había llamado a este action
  // con estos dos campos todavía (F7 sin construir) — el bug no se había
  // topado. A6 es la primera llamadora real de `installedAt` aquí.
  if (typeof data.installedAt === "string") data.installedAt = new Date(data.installedAt);
  if (typeof data.startDate === "string") data.startDate = new Date(data.startDate);
  if (parsed.data.status === "DROPPED_OUT" && !data.droppedOutAt) {
    data.droppedOutAt = new Date();
  }
  if (parsed.data.status && parsed.data.status !== before.status) {
    data.statusUpdatedAt = new Date();
  }
  // A6 · si se pone/cambia la fecha de colocación y el caso seguía como
  // PLANNED (sin que este mismo update toque `status` a mano), el caso
  // arranca: sin esto, "sin empezar" se quedaba así para siempre en
  // cualquier caso que no puso la fecha al crearlo (hallazgo del alcance).
  if (
    data.installedAt instanceof Date &&
    !parsed.data.status &&
    before.status === "PLANNED"
  ) {
    data.status = "IN_PROGRESS";
    data.statusUpdatedAt = new Date();
  }

  try {
    let altaCasoFieldsSaved = true;
    const updated = await prisma
      .$transaction(async (tx) => {
        const finalData = { ...data };
        if (newResponsibleGuardian && !finalData.responsibleGuardianId) {
          const guardian = await tx.guardian.create({
            data: {
              clinicId: ctx.clinicId,
              patientId: before.patientId,
              fullName: newResponsibleGuardian.fullName,
              parentesco: newResponsibleGuardian.parentesco,
              phone: newResponsibleGuardian.phone,
              esResponsableLegal: true,
              principal: true,
              createdBy: ctx.userId,
            },
            select: { id: true },
          });
          finalData.responsibleGuardianId = guardian.id;
        }
        return tx.orthodonticTreatmentPlan.update({ where: { id: treatmentPlanId }, data: finalData });
      })
      .catch(async (e) => {
        const touchesAltaCaso =
          ALTA_CASO_PLAN_FIELDS.some((k) => k in data) || Boolean(newResponsibleGuardian);
        if (!touchesAltaCaso || !isMissingColumnError(e)) throw e;
        altaCasoFieldsSaved = false;
        const reduced = { ...data };
        for (const k of ALTA_CASO_PLAN_FIELDS) delete reduced[k];
        console.error(
          "[ortho] updateTreatmentPlan: columnas de alta-caso.sql aún no existen, se guarda sin doctor/responsable:",
          e,
        );
        return prisma.orthodonticTreatmentPlan.update({ where: { id: treatmentPlanId }, data: reduced });
      });

    const action =
      parsed.data.status && parsed.data.status !== before.status
        ? ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_STATUS_CHANGED
        : ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_UPDATED;

    await auditOrtho({
      ctx,
      action,
      entityType: "OrthodonticTreatmentPlan",
      entityId: updated.id,
      // `treatingDoctorId` va a la bitácora para que una reasignación deje
      // dicho quién llevaba el caso y desde cuándo: de ahí sale a qué doctor se
      // le atribuye cada cobro (produccion.ts). `undefined` si la columna de
      // sql/ortodoncia-alta-caso.sql aún no existe: `auditOrtho` lo ignora.
      before: {
        status: before.status,
        totalCostMxn: before.totalCostMxn.toString(),
        treatingDoctorId: (before as { treatingDoctorId?: string | null }).treatingDoctorId ?? null,
      },
      after: {
        status: updated.status,
        totalCostMxn: updated.totalCostMxn.toString(),
        treatingDoctorId: (updated as { treatingDoctorId?: string | null }).treatingDoctorId ?? null,
      },
    });

    revalidatePath(`/dashboard/patients/${updated.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${updated.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);
    void diagnosisId;
    void patientId;
    return ok({ id: updated.id, altaCasoFieldsSaved });
  } catch (e) {
    console.error("[ortho] updateTreatmentPlan failed:", e);
    return fail("No se pudo actualizar el plan");
  }
}
