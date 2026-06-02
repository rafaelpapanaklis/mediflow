export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveLabChatCaller,
  serializeThread,
  lastMessageInclude,
} from "@/lib/laboratorios/chat-access";

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" };

/**
 * POST /api/lab-chat/start — abre (o reutiliza) el hilo entre la clínica
 * y un laboratorio. Hay un único hilo por par (clinicId, labId), así que
 * usamos upsert sobre el unique compuesto.
 *
 * Lado clínica (contrato): body { labId }. El clinicId sale de sesión.
 * Lado laboratorio (extensión simétrica): body { clinicId }. El labId sale
 * de sesión. En ambos casos el id propio NUNCA se toma del body.
 */
export async function POST(req: Request) {
  const caller = await resolveLabChatCaller();
  if (!caller) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400, headers: NO_STORE });
  }

  if (caller.side === "CLINIC") {
    const labId = typeof body?.labId === "string" ? body.labId.trim() : "";
    if (!labId) {
      return NextResponse.json({ error: "labId es requerido." }, { status: 400, headers: NO_STORE });
    }
    const lab = await prisma.dentalLab.findUnique({
      where: { id: labId },
      select: { id: true },
    });
    if (!lab) {
      return NextResponse.json({ error: "Laboratorio no encontrado." }, { status: 404, headers: NO_STORE });
    }
    const thread = await prisma.dentalLabChatThread.upsert({
      where: { clinicId_labId: { clinicId: caller.clinicId, labId } },
      create: { clinicId: caller.clinicId, labId },
      update: {},
      include: {
        messages: lastMessageInclude,
        lab: { select: { id: true, name: true, logoUrl: true } },
      },
    });
    return NextResponse.json(serializeThread(thread), { status: 201, headers: NO_STORE });
  }

  // Lado laboratorio.
  const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
  if (!clinicId) {
    return NextResponse.json({ error: "clinicId es requerido." }, { status: 400, headers: NO_STORE });
  }
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true },
  });
  if (!clinic) {
    return NextResponse.json({ error: "Clínica no encontrada." }, { status: 404, headers: NO_STORE });
  }
  const thread = await prisma.dentalLabChatThread.upsert({
    where: { clinicId_labId: { clinicId, labId: caller.labId } },
    create: { clinicId, labId: caller.labId },
    update: {},
    include: {
      messages: lastMessageInclude,
      clinic: { select: { id: true, name: true, logoUrl: true } },
    },
  });
  return NextResponse.json(serializeThread(thread), { status: 201, headers: NO_STORE });
}
