import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/insights
 * Devuelve los últimos 8 weekly_insights de la clínica del usuario +
 * unreadCount global. Multi-tenant: clinicId desde getCurrentUser.
 *
 * PATCH /api/notifications/insights
 * Body: { id?: string, all?: boolean }
 *  - id: marca un insight específico como read (validando que pertenezca
 *    a la clínica del usuario).
 *  - all: marca todos los unread de la clínica como read.
 */
export async function GET() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const [list, unreadCount] = await Promise.all([
    prisma.weeklyInsight.findMany({
      where: { clinicId },
      orderBy: { weekStart: "desc" },
      take: 8,
      select: {
        id: true,
        weekStart: true,
        weekEnd: true,
        summary: true,
        insights: true,
        read: true,
        createdAt: true,
      },
    }),
    prisma.weeklyInsight.count({
      where: { clinicId, read: false },
    }),
  ]);

  return NextResponse.json({
    insights: list.map((i) => ({
      id: i.id,
      weekStart: i.weekStart.toISOString(),
      weekEnd: i.weekEnd.toISOString(),
      summary: i.summary,
      insights: i.insights,
      read: i.read,
      createdAt: i.createdAt.toISOString(),
    })),
    unreadCount,
  });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  let body: { id?: string; all?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.all === true) {
    // Mark all unread → read for THIS clinic only.
    const result = await prisma.weeklyInsight.updateMany({
      where: { clinicId, read: false },
      data: { read: true },
    });
    return NextResponse.json({ updated: result.count });
  }

  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  // Validar tenant antes de update: el insight debe pertenecer a la
  // clínica del usuario.
  const result = await prisma.weeklyInsight.updateMany({
    where: { id: body.id, clinicId },
    data: { read: true },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ updated: result.count });
}
