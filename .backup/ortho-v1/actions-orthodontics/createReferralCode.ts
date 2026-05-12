"use server";
// Orthodontics — createReferralCode. Sección H G12: genera código de
// referidos personalizado (ej. "GABY26") único por clínica.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  /** Código sugerido. Si choca, se intenta con sufijos numéricos. */
  code: z
    .string()
    .min(3)
    .max(16)
    .regex(/^[A-Z0-9_-]+$/, "Solo mayúsculas, dígitos, guiones"),
  rewardLabel: z.string().max(120).nullable().optional(),
});

export async function createReferralCode(
  input: unknown,
): Promise<ActionResult<{ id: string; code: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, clinicId: true },
  });
  if (!plan) return fail("Plan no encontrado");

  try {
    // Resolver colisiones: GABY26 → GABY26-1 → GABY26-2 …
    let code = parsed.data.code;
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? parsed.data.code : `${parsed.data.code}-${i}`;
      const exists = await prisma.orthoReferralCode.findUnique({
        where: { clinicId_code: { clinicId: plan.clinicId, code: candidate } },
        select: { id: true },
      });
      if (!exists) {
        code = candidate;
        break;
      }
    }

    const created = await prisma.orthoReferralCode.upsert({
      where: { treatmentPlanId: plan.id },
      create: {
        treatmentPlanId: plan.id,
        patientId: plan.patientId,
        clinicId: plan.clinicId,
        code,
        rewardLabel: parsed.data.rewardLabel ?? null,
      },
      update: {
        code,
        rewardLabel: parsed.data.rewardLabel ?? null,
      },
      select: { id: true, code: true },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.REFERRAL_CODE_CREATED,
      entityType: "OrthoReferralCode",
      entityId: created.id,
      after: { code: created.code },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    return ok({ id: created.id, code: created.code });
  } catch (e) {
    console.error("[ortho] createReferralCode failed:", e);
    return fail("No se pudo crear el código de referidos");
  }
}
