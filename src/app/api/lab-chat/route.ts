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
 * GET /api/lab-chat — hilos del que llama, ordenados por actividad.
 * Vista clínica (por clinicId) o laboratorio (por labId) según la sesión.
 * Cada hilo trae su contraparte y el último mensaje (preview de la bandeja).
 */
export async function GET() {
  const caller = await resolveLabChatCaller();
  if (!caller) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  if (caller.side === "CLINIC") {
    const threads = await prisma.dentalLabChatThread.findMany({
      where: { clinicId: caller.clinicId },
      orderBy: { lastMessageAt: "desc" },
      include: {
        messages: lastMessageInclude,
        lab: { select: { id: true, name: true, logoUrl: true } },
      },
    });
    return NextResponse.json(threads.map(serializeThread), { headers: NO_STORE });
  }

  const threads = await prisma.dentalLabChatThread.findMany({
    where: { labId: caller.labId },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: lastMessageInclude,
      clinic: { select: { id: true, name: true, logoUrl: true } },
    },
  });
  return NextResponse.json(threads.map(serializeThread), { headers: NO_STORE });
}
