import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { cachedByKey, claveDeClinica, invalidateCachedKey } from "@/lib/route-cache";

export const dynamic = "force-dynamic";

// La campanita de insights (solo ADMIN/SUPER_ADMIN) pide esto al cargar cada
// pantalla. weekly_insight se filtra solo por clinicId (no hay "leído" por
// usuario), así que el resultado es igual para toda la clínica y puede
// compartirse dentro del TTL.
//
// CUÁNTO PUEDE ENVEJECER (ws1-t1): 2 min. Los insights los crea un cron una
// vez por SEMANA (lunes 04:00 UTC, vercel.json), así que lo único que cambia
// entre semana es el «leído». Quien lo marca ve el 0 en el acto (el popover lo
// pone a mano y su siguiente GET va con `?fresco=1`); otro admin de la misma
// clínica lo ve como mucho 2 min (caché) + 5 min (sondeo del popover) después.
// El PATCH invalida además la instancia que lo atendió.
const CACHE_TTL_MS = 2 * 60_000;
const cacheKey = (clinicId: string) => claveDeClinica("notifications-insights", clinicId);

/**
 * GET /api/notifications/insights[?fresco=1]
 * Devuelve los últimos 8 weekly_insights de la clínica del usuario +
 * unreadCount global. Multi-tenant: clinicId desde getCurrentUser.
 *
 * PATCH /api/notifications/insights
 * Body: { id?: string, all?: boolean }
 *  - id: marca un insight específico como read (validando que pertenezca
 *    a la clínica del usuario).
 *  - all: marca todos los unread de la clínica como read.
 */
export async function GET(req?: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;
  const fresco = req?.nextUrl?.searchParams.get("fresco") === "1";

  const [list, unreadCount] = await cachedByKey(cacheKey(clinicId), CACHE_TTL_MS, () =>
    Promise.all([
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
    ]),
    { fresco },
  );

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
    invalidateCachedKey(cacheKey(clinicId));
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
  invalidateCachedKey(cacheKey(clinicId));

  if (result.count === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ updated: result.count });
}
