import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getOrCreateBotConfig, toFaqDTO } from "../service";

export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp/bot/faqs
 * Crea una FAQ { question, answer, enabled?, order? } para la clínica de
 * sesión. Setea clinicId (de la sesión) y configId (config de la clínica,
 * creada si no existe) — la FAQ guarda ambos por el índice del motor.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!question || !answer) {
    return NextResponse.json({ error: "question y answer requeridos" }, { status: 400 });
  }
  const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
  const order =
    typeof body.order === "number" && Number.isFinite(body.order) ? Math.trunc(body.order) : 0;

  const config = await getOrCreateBotConfig(ctx.clinicId);
  const faq = await prisma.whatsAppBotFaq.create({
    data: { clinicId: ctx.clinicId, configId: config.id, question, answer, enabled, order },
  });

  return NextResponse.json({ faq: toFaqDTO(faq) });
}
