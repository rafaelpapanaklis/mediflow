"use server";
// Orthodontics — updateRetentionRegimenConfig. Sección G "Configurar régimen":
// permite a la clínica setear el régimen de retención por escrito ANTES del
// debonding (al avanzar a fase Retención el régimen se ejecuta auto).
//
// Campos editables:
//   - upperRetainer (HAWLEY_SUP / ESSIX_SUP / OTHER)
//   - lowerRetainer (HAWLEY_INF / ESSIX_INF / OTHER)
//   - fixedLingualPresent + gauge (.0175/.0195/.021)
//   - regimenDescription (texto libre)
//   - preSurveyEnabled (boolean)

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const retainerEnum = z.enum([
  "HAWLEY_SUP",
  "HAWLEY_INF",
  "ESSIX_SUP",
  "ESSIX_INF",
  "FIXED_LINGUAL_3_3",
  "NONE",
]);
const gaugeEnum = z.enum(["G_0175", "G_0195", "G_021"]);

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  upperRetainer: retainerEnum.nullable().optional(),
  upperDescription: z.string().max(500).nullable().optional(),
  lowerRetainer: retainerEnum.nullable().optional(),
  lowerDescription: z.string().max(500).nullable().optional(),
  fixedLingualPresent: z.boolean().default(false),
  fixedLingualGauge: gaugeEnum.nullable().optional(),
  regimenDescription: z.string().min(2).max(500),
  preSurveyEnabled: z.boolean().default(true),
});

export async function updateRetentionRegimenConfig(
  input: unknown,
): Promise<ActionResult<{ regimenId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");

  try {
    const regimen = await prisma.orthoRetentionRegimen.upsert({
      where: { treatmentPlanId: plan.id },
      create: {
        treatmentPlanId: plan.id,
        clinicId: plan.clinicId,
        upperRetainer: data.upperRetainer ?? null,
        upperDescription: data.upperDescription ?? null,
        lowerRetainer: data.lowerRetainer ?? null,
        lowerDescription: data.lowerDescription ?? null,
        fixedLingualPresent: data.fixedLingualPresent,
        fixedLingualGauge: data.fixedLingualGauge ?? null,
        regimenDescription: data.regimenDescription,
        preSurveyEnabled: data.preSurveyEnabled,
      },
      update: {
        upperRetainer: data.upperRetainer ?? null,
        upperDescription: data.upperDescription ?? null,
        lowerRetainer: data.lowerRetainer ?? null,
        lowerDescription: data.lowerDescription ?? null,
        fixedLingualPresent: data.fixedLingualPresent,
        fixedLingualGauge: data.fixedLingualGauge ?? null,
        regimenDescription: data.regimenDescription,
        preSurveyEnabled: data.preSurveyEnabled,
      },
      select: { id: true },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.RETENTION_REGIMEN_CONFIGURED,
      entityType: "OrthoRetentionRegimen",
      entityId: regimen.id,
      after: {
        upperRetainer: data.upperRetainer,
        lowerRetainer: data.lowerRetainer,
        fixedLingualPresent: data.fixedLingualPresent,
        regimenDescription: data.regimenDescription,
      },
    });

    try {
      revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
      revalidatePath(`/dashboard/patients/${plan.patientId}`);
    } catch (e) {
      console.error("[ortho] updateRetentionRegimenConfig · revalidate:", e);
    }
    return ok({ regimenId: regimen.id });
  } catch (e) {
    console.error("[ortho] updateRetentionRegimenConfig failed:", e);
    return fail(
      e instanceof Error
        ? `No se pudo guardar el régimen: ${e.message}`
        : "No se pudo guardar el régimen",
    );
  }
}
