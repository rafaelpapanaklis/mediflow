"use server";
// Orthodontics — sendSignAtHomeLink. G6: genera token JWT-like y crea
// el package OrthoSignAtHomePackage. El envío real por WhatsApp requiere
// Twilio API key (TODO).

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  scenarioId: z.string().uuid().optional(),
  /** Días hasta expiración del token. Default 7. */
  expiresInDays: z.number().int().positive().max(30).default(7),
});

function genToken(): string {
  // Token base64url 32 bytes (256 bits) — entropía suficiente sin librerías.
  return `sgnh_${randomBytes(32).toString("base64url")}`;
}

export async function sendSignAtHomeLink(
  input: unknown,
): Promise<ActionResult<{ packageId: string; token: string; expiresAt: Date }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");

  let scenarioId = parsed.data.scenarioId;
  let downPaymentAmount: number | null = null;
  if (scenarioId) {
    const scenario = await prisma.orthoQuoteScenario.findFirst({
      where: { id: scenarioId, clinicId: ctx.clinicId },
      select: { id: true, downPayment: true },
    });
    if (!scenario) return fail("Escenario no encontrado");
    downPaymentAmount = Number(scenario.downPayment);
  } else {
    const accepted = await prisma.orthoQuoteScenario.findFirst({
      where: {
        treatmentPlanId: plan.id,
        clinicId: ctx.clinicId,
        status: "ACCEPTED",
      },
      select: { id: true, downPayment: true },
    });
    if (accepted) {
      scenarioId = accepted.id;
      downPaymentAmount = Number(accepted.downPayment);
    }
  }

  try {
    const token = genToken();
    const expiresAt = new Date(
      Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000,
    );

    const created = await prisma.orthoSignAtHomePackage.create({
      data: {
        treatmentPlanId: plan.id,
        patientId: plan.patientId,
        clinicId: plan.clinicId,
        token,
        expiresAt,
        status: "SENT",
        selectedQuoteScenarioId: scenarioId ?? null,
        downPaymentAmount,
        sentAt: new Date(),
        createdById: ctx.userId,
      },
      select: { id: true, token: true, expiresAt: true },
    });

    // TODO: Twilio WhatsApp API. Por ahora marcamos SENT pero el mensaje
    // real no sale hasta que se configure la API key TWILIO_AUTH_TOKEN
    // + WHATSAPP_FROM en Vercel env vars.
    console.warn(
      "[ortho] sendSignAtHomeLink: stub — Twilio no configurado. Token:",
      created.token,
    );

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.SIGN_AT_HOME_SENT,
      entityType: "OrthoSignAtHomePackage",
      entityId: created.id,
      after: { tokenPrefix: created.token.slice(0, 16), expiresAt: created.expiresAt },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    return ok({
      packageId: created.id,
      token: created.token,
      expiresAt: created.expiresAt,
    });
  } catch (e) {
    console.error("[ortho] sendSignAtHomeLink failed:", e);
    return fail("No se pudo enviar el link Sign@Home");
  }
}
