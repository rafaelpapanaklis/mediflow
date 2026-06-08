import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { toFaqDTO } from "../../service";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/whatsapp/bot/faqs/[id]
 * Edita una FAQ { question?, answer?, enabled?, order? }. Guard de pertenencia:
 * findFirst { id, clinicId } antes de mutar — clinicId de la sesión.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.whatsAppBotFaq.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "FAQ no encontrada" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const data: Prisma.WhatsAppBotFaqUpdateInput = {};
  if (typeof body.question === "string") {
    const t = body.question.trim();
    if (t) data.question = t;
  }
  if (typeof body.answer === "string") {
    const t = body.answer.trim();
    if (t) data.answer = t;
  }
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.order === "number" && Number.isFinite(body.order)) data.order = Math.trunc(body.order);

  const faq = await prisma.whatsAppBotFaq.update({ where: { id: params.id }, data });
  return NextResponse.json({ faq: toFaqDTO(faq) });
}

/**
 * DELETE /api/whatsapp/bot/faqs/[id]
 * Borra una FAQ. Guard de pertenencia por clinicId (doble cinturón con
 * deleteMany { id, clinicId }).
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.whatsAppBotFaq.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "FAQ no encontrada" }, { status: 404 });

  await prisma.whatsAppBotFaq.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });
  return NextResponse.json({ ok: true });
}
