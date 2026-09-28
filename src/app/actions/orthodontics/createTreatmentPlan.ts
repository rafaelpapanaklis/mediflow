"use server";
// Orthodontics — action 3/15: createTreatmentPlan + 6 phases en transacción. SPEC §5.2.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createTreatmentPlanSchema } from "@/lib/validation/orthodontics";
import { PHASE_ORDER } from "@/lib/orthodontics/phase-machine";
import { enqueueOrthoWhatsApp } from "@/lib/orthodontics/whatsapp-queue";
import { isMissingColumnError } from "@/lib/orthodontics/alta-caso-tolerance";
import {
  auditOrtho,
  getOrthoActionContext,
  loadPatientForOrtho,
} from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createTreatmentPlan(
  input: unknown,
): Promise<ActionResult<{ id: string; altaCasoFieldsSaved: boolean }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createTreatmentPlanSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForOrtho({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  // Validar que el diagnóstico exista y no esté tomado por otro plan.
  const dx = await prisma.orthodonticDiagnosis.findFirst({
    where: { id: parsed.data.diagnosisId, clinicId: ctx.clinicId, deletedAt: null },
    include: { treatmentPlan: { select: { id: true } } },
  });
  if (!dx) return fail("Diagnóstico no encontrado");
  if (dx.treatmentPlan)
    return fail("Ya existe un plan para este diagnóstico", dx.treatmentPlan.id);

  const installedAt = parsed.data.installedAt ? new Date(parsed.data.installedAt) : null;

  // Ola 1 (ws1-t6) — A5 (doctor tratante) ya trae su columna de la Ola 0.
  // A11 (responsable del pago): un Guardian existente, o se crea uno nuevo
  // reutilizando el modelo de pediatría (sin exigir PediatricRecord). Ambas
  // columnas nuevas — si sql/ortodoncia-alta-caso.sql aún no está pegado,
  // se reintenta la transacción completa sin ellas (P2021/P2022): el caso
  // se abre igual, sin doctor/responsable, para no tumbar dev.108.
  const withAltaCasoFields = {
    treatingDoctorId: parsed.data.treatingDoctorId ?? null,
    responsibleGuardianId: parsed.data.responsibleGuardianId ?? null,
  };
  const wantsAltaCasoFields =
    withAltaCasoFields.treatingDoctorId != null ||
    withAltaCasoFields.responsibleGuardianId != null ||
    Boolean(parsed.data.newResponsibleGuardian);

  const runTransaction = (includeAltaCasoFields: boolean) =>
    prisma.$transaction(async (tx) => {
      let responsibleGuardianId = withAltaCasoFields.responsibleGuardianId;
      if (includeAltaCasoFields && !responsibleGuardianId && parsed.data.newResponsibleGuardian) {
        const g = parsed.data.newResponsibleGuardian;
        const guardian = await tx.guardian.create({
          data: {
            clinicId: ctx.clinicId,
            patientId: parsed.data.patientId,
            fullName: g.fullName,
            parentesco: g.parentesco,
            phone: g.phone,
            esResponsableLegal: true,
            principal: true,
            createdBy: ctx.userId,
          },
          select: { id: true },
        });
        responsibleGuardianId = guardian.id;
      }

      const plan = await tx.orthodonticTreatmentPlan.create({
        data: {
          diagnosisId: parsed.data.diagnosisId,
          patientId: parsed.data.patientId,
          clinicId: ctx.clinicId,
          technique: parsed.data.technique,
          techniqueNotes: parsed.data.techniqueNotes ?? null,
          estimatedDurationMonths: parsed.data.estimatedDurationMonths,
          startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
          installedAt,
          totalCostMxn: parsed.data.totalCostMxn,
          anchorageType: parsed.data.anchorageType,
          anchorageNotes: parsed.data.anchorageNotes ?? null,
          extractionsRequired: parsed.data.extractionsRequired,
          extractionsTeethFdi: parsed.data.extractionsTeethFdi,
          iprRequired: parsed.data.iprRequired,
          tadsRequired: parsed.data.tadsRequired,
          treatmentObjectives: parsed.data.treatmentObjectives,
          patientGoals: parsed.data.patientGoals ?? null,
          retentionPlanText: parsed.data.retentionPlanText,
          status: installedAt ? "IN_PROGRESS" : "PLANNED",
          signedTreatmentConsentFileId: parsed.data.signedTreatmentConsentFileId ?? null,
          ...(includeAltaCasoFields
            ? {
                treatingDoctorId: withAltaCasoFields.treatingDoctorId,
                responsibleGuardianId,
              }
            : {}),
        },
      });

      // 6 fases con orderIndex 0..5. Si hay installedAt, ALIGNMENT arranca.
      for (let i = 0; i < PHASE_ORDER.length; i++) {
        const phaseKey = PHASE_ORDER[i]!;
        const isFirst = i === 0;
        await tx.orthodonticPhase.create({
          data: {
            treatmentPlanId: plan.id,
            clinicId: ctx.clinicId,
            phaseKey,
            orderIndex: i,
            status: isFirst && installedAt ? "IN_PROGRESS" : "NOT_STARTED",
            startedAt: isFirst && installedAt ? installedAt : null,
          },
        });
      }

      return plan;
    });

  try {
    let altaCasoFieldsSaved = wantsAltaCasoFields;
    const created = await runTransaction(wantsAltaCasoFields).catch(async (e) => {
      if (!wantsAltaCasoFields || !isMissingColumnError(e)) throw e;
      altaCasoFieldsSaved = false;
      console.error(
        "[ortho] createTreatmentPlan: columnas de alta-caso.sql aún no existen, se crea sin doctor/responsable:",
        e,
      );
      return runTransaction(false);
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_CREATED,
      entityType: "OrthodonticTreatmentPlan",
      entityId: created.id,
      after: {
        technique: created.technique,
        durationMonths: created.estimatedDurationMonths,
        totalCostMxn: created.totalCostMxn.toString(),
        installed: Boolean(installedAt),
      },
    });

    // ─── WhatsApp queue F9.5 — PRE_INSTALLATION_INSTRUCTIONS ──────────
    // Si el plan se programa con installedAt >24h en el futuro, encolar
    // recordatorio para 24h antes de la cita de instalación.
    if (installedAt) {
      const remindAt = new Date(installedAt.getTime() - 24 * 60 * 60 * 1000);
      if (remindAt.getTime() > Date.now() + 60_000) {
        const phoneRow = await prisma.patient.findUnique({
          where: { id: parsed.data.patientId },
          select: { phone: true },
        });
        if (phoneRow?.phone) {
          await enqueueOrthoWhatsApp(prisma, {
            clinicId: ctx.clinicId,
            templateKey: "PRE_INSTALLATION_INSTRUCTIONS",
            scheduledFor: remindAt,
            patientPhone: phoneRow.phone,
          }).catch((e) => {
            console.error("[ortho] WA enqueue PRE_INSTALL failed (no bloquea):", e);
          });
        }
      }
    }

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);

    return ok({ id: created.id, altaCasoFieldsSaved });
  } catch (e) {
    console.error("[ortho] createTreatmentPlan failed:", e);
    return fail("No se pudo crear el plan");
  }
}
