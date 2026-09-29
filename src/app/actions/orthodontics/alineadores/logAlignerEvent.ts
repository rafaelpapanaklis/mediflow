"use server";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026). H12.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auditOrtho } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";
import { getOrthoImagingContext, isMissingRelation } from "../imagen/_context";

const EVENT_TYPES = [
  "DELIVERY",
  "REFINEMENT",
  "TRAY_CHANGE",
  "ATTACHMENT_PLACED",
  "ATTACHMENT_LOST",
  "PAUSE",
  "RESUME",
] as const;

export interface LogAlignerEventInput {
  treatmentPlanId: string;
  eventType: (typeof EVENT_TYPES)[number];
  trayNumber?: number | null;
  quantity?: number | null;
  notes?: string | null;
}

/** Registra un evento (entrega, refinamiento, cambio manual, attachment) y ajusta contadores del caso. */
export async function logAlignerEvent(input: LogAlignerEventInput): Promise<ActionResult<{ id: string }>> {
  if (!input.treatmentPlanId) return fail("Falta el caso de ortodoncia");
  if (!EVENT_TYPES.includes(input.eventType)) return fail("Tipo de evento inválido");

  const auth = await getOrthoImagingContext(input.treatmentPlanId);
  if (isFailure(auth)) return auth;
  const { ctx, patientId } = auth.data;

  try {
    const aligner = await prisma.orthodonticAligner.findFirst({
      where: { treatmentPlanId: input.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
      select: { id: true },
    });
    if (!aligner) return fail("Primero registra el caso de alineadores");

    const event = await prisma.orthodonticAlignerEvent.create({
      data: {
        alignerId: aligner.id,
        clinicId: ctx.clinicId,
        eventType: input.eventType,
        trayNumber: input.trayNumber ?? null,
        quantity: input.quantity ?? null,
        notes: input.notes ?? null,
        createdByUserId: ctx.userId,
      },
      select: { id: true },
    });

    // Ajustes automáticos de contadores según el tipo de evento — mantienen
    // el caso consistente sin obligar a un segundo formulario.
    const counterUpdate: Record<string, unknown> = {};
    if (input.eventType === "TRAY_CHANGE" && typeof input.trayNumber === "number") {
      counterUpdate.currentTray = input.trayNumber;
    }
    if (input.eventType === "REFINEMENT") {
      counterUpdate.refinementCount = { increment: 1 };
    }
    if (input.eventType === "ATTACHMENT_LOST") {
      counterUpdate.attachmentsLost = { increment: input.quantity ?? 1 };
    }
    if (Object.keys(counterUpdate).length > 0) {
      await prisma.orthodonticAligner.update({ where: { id: aligner.id }, data: counterUpdate });
    }

    await auditOrtho({
      ctx,
      action: "aligner_event_logged",
      entityType: "OrthodonticAlignerEvent",
      entityId: event.id,
      patientId: patientId,
      after: { alignerId: aligner.id, ...input },
    });

    revalidatePath(`/dashboard/patients/${patientId}/orthodontics`);

    return ok({ id: event.id });
  } catch (e) {
    if (isMissingRelation(e)) {
      return fail("El seguimiento de alineadores todavía no está configurado en esta clínica (falta pegar el SQL)");
    }
    console.error("[ortho alineadores] logAlignerEvent failed:", e);
    return fail("No se pudo registrar el evento");
  }
}
