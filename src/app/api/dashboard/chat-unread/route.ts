import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" };

/**
 * GET /api/dashboard/chat-unread
 * Total de mensajes no-leídos de la clínica por canal, para el badge del
 * ChatLauncher flotante. Suma clinicUnread de los hilos de cada tipo.
 * Scoping SIEMPRE por ctx.clinicId (sesión); 401 si no hay sesión.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
  }
  try {
    const [labAgg, supplierAgg] = await Promise.all([
      prisma.dentalLabChatThread.aggregate({
        where: { clinicId: ctx.clinicId },
        _sum: { clinicUnread: true },
      }),
      prisma.supplierChatThread.aggregate({
        where: { clinicId: ctx.clinicId },
        _sum: { clinicUnread: true },
      }),
    ]);
    const lab = labAgg._sum.clinicUnread ?? 0;
    const supplier = supplierAgg._sum.clinicUnread ?? 0;
    return NextResponse.json({ lab, supplier, total: lab + supplier }, { headers: NO_STORE });
  } catch (err) {
    console.error("[GET /api/dashboard/chat-unread]", err);
    return NextResponse.json({ lab: 0, supplier: 0, total: 0 }, { headers: NO_STORE });
  }
}
