export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveChatCaller,
  serializeThread,
  lastMessageInclude,
} from "@/lib/suppliers/chat-access";

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" };

/**
 * GET /api/supplier-chat — hilos del que llama, ordenados por actividad.
 * Vista clínica (por clinicId) o proveedor (por supplierId) según la sesión.
 * Cada hilo trae su contraparte y el último mensaje (preview de la bandeja).
 */
export async function GET() {
  const caller = await resolveChatCaller();
  if (!caller) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }

  if (caller.side === "CLINIC") {
    const threads = await prisma.supplierChatThread.findMany({
      where: { clinicId: caller.clinicId },
      orderBy: { lastMessageAt: "desc" },
      include: {
        messages: lastMessageInclude,
        supplier: { select: { id: true, businessName: true, logoUrl: true } },
      },
    });
    return NextResponse.json(threads.map(serializeThread), { headers: NO_STORE });
  }

  const threads = await prisma.supplierChatThread.findMany({
    where: { supplierId: caller.supplierId },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: lastMessageInclude,
      clinic: { select: { id: true, name: true, logoUrl: true } },
    },
  });
  return NextResponse.json(threads.map(serializeThread), { headers: NO_STORE });
}
