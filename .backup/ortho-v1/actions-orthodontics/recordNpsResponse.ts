"use server";
// Orthodontics — recordNpsResponse. Cuando el paciente responde la
// encuesta NPS post-debond, registramos el score y, si NPS ≥ 9, marcamos
// googleReviewTriggered=true (el envío real del link Google es TODO).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  npsScheduleId: z.string().uuid(),
  npsScore: z.number().int().min(0).max(10),
  patientComment: z.string().max(2000).nullable().optional(),
});

export async function recordNpsResponse(
  input: unknown,
): Promise<ActionResult<{ id: string; googleReviewTriggered: boolean }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const schedule = await prisma.orthoNpsSchedule.findFirst({
    where: { id: parsed.data.npsScheduleId, clinicId: ctx.clinicId },
    select: { id: true, patientId: true, status: true, googleReviewTriggered: true },
  });
  if (!schedule) return fail("Programación NPS no encontrada");
  if (schedule.status === "RESPONDED") return fail("Esta encuesta ya fue respondida");

  const triggerGoogleReview = parsed.data.npsScore >= 9;

  try {
    await prisma.orthoNpsSchedule.update({
      where: { id: schedule.id },
      data: {
        status: "RESPONDED",
        respondedAt: new Date(),
        npsScore: parsed.data.npsScore,
        patientComment: parsed.data.patientComment ?? null,
        googleReviewTriggered: triggerGoogleReview,
      },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.NPS_RESPONSE_RECORDED,
      entityType: "OrthoNpsSchedule",
      entityId: schedule.id,
      after: {
        npsScore: parsed.data.npsScore,
        googleReviewTriggered: triggerGoogleReview,
      },
    });

    if (triggerGoogleReview) {
      // TODO: enviar WhatsApp con liga directa Google reviews vía Twilio.
      // Twilio API key + GOOGLE_REVIEW_URL_<clinicId> requeridos.
      console.warn(
        "[ortho] recordNpsResponse: NPS ≥ 9 pero Twilio no configurado, Google review no enviada.",
      );
      await auditOrtho({
        ctx,
        action: ORTHO_AUDIT_ACTIONS.GOOGLE_REVIEW_TRIGGERED,
        entityType: "OrthoNpsSchedule",
        entityId: schedule.id,
        after: { score: parsed.data.npsScore, channel: "whatsapp-stub" },
      });
    }

    revalidatePath(`/dashboard/specialties/orthodontics/${schedule.patientId}`);
    return ok({ id: schedule.id, googleReviewTriggered: triggerGoogleReview });
  } catch (e) {
    console.error("[ortho] recordNpsResponse failed:", e);
    return fail("No se pudo registrar la respuesta NPS");
  }
}
