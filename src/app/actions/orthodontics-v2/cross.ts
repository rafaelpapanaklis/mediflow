"use server";

// Cross-module · 2 server actions (SPEC §1.3 CROSS-MODULE).

import { prisma } from "@/lib/prisma";
import { fail, ok, reFail, type Result } from "@/lib/orthodontics-v2/types";
import type { CommunicationLog } from "@prisma/client";
import { SendWhatsAppSchema } from "@/lib/orthodontics-v2/schemas";
import { guardCase, requirePermission } from "./_auth";

export async function openAIWithContext(
  caseId: string,
): Promise<Result<{ redirectUrl: string }>> {
  const auth = await requirePermission("ask_ai_with_context");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, caseId);
  if (!g.ok) return reFail(g);
  if (!auth.data.aiAssistantEnabled)
    return fail("conflict", "AI Assistant no contratado · contratar");

  return ok({
    redirectUrl: `/dashboard/ai-assistant?context=ortho-case-${caseId}`,
  });
}

export async function sendWhatsApp(input: {
  caseId: string;
  body: string;
  templateId?: string;
}): Promise<Result<CommunicationLog>> {
  const parsed = SendWhatsAppSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");
  const auth = await requirePermission("send_whatsapp");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  // Twilio para envío real · stub Fase 2 (servicio externo autorizado).
  // El log se persiste igual aunque el envío sea simulado.
  const log = await prisma.communicationLog.create({
    data: {
      caseId: input.caseId,
      channel: "whatsapp",
      direction: "OUT",
      body: parsed.data.body,
      templateId: parsed.data.templateId,
    },
  });
  return ok(log);
}
