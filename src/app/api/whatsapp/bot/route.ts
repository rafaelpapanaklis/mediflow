import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getOrCreateBotConfig, toConfigDTO, toFaqDTO, buildConfigUpdate } from "./service";

export const dynamic = "force-dynamic";

/**
 * GET /api/whatsapp/bot
 * Config del bot de la clínica de sesión (se crea con defaults si no existe) +
 * sus FAQs ordenadas. Multi-tenant: clinicId SIEMPRE de la sesión.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await getOrCreateBotConfig(ctx.clinicId);
  const faqs = await prisma.whatsAppBotFaq.findMany({
    where: { clinicId: ctx.clinicId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    config: toConfigDTO(config),
    faqs: faqs.map(toFaqDTO),
  });
}

/**
 * PATCH /api/whatsapp/bot
 * Actualiza enabled, botName, persona, greeting, businessHours, afterHoursMsg,
 * canAnswerFaq, canBookAppointments, fallbackToHuman (whitelist). clinicId de
 * la sesión; nunca del body.
 */
export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Garantiza que exista la fila antes del update (idempotente).
  await getOrCreateBotConfig(ctx.clinicId);

  const data = buildConfigUpdate(body);
  const updated = await prisma.whatsAppBotConfig.update({
    where: { clinicId: ctx.clinicId },
    data,
  });

  return NextResponse.json({ config: toConfigDTO(updated) });
}
