import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/occupancy?from=&to=&resourceId=&doctorId=
 *
 * Devuelve heatmap[7][nHours] con % ocupación por celda (día semana × hora).
 * Cell value = (citas en ese slot / sillones disponibles) × 100.
 * >100 = overbooking. 0 = sin citas.
 *
 * Filtros opcionales:
 *  - resourceId: solo citas asignadas a ese sillón (denominador = 1)
 *  - doctorId: solo citas de ese doctor
 *
 * Default range: últimos 30 días.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const resourceId = url.searchParams.get("resourceId");
  const doctorId = url.searchParams.get("doctorId");

  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [clinic, totalChairs, appts] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { agendaDayStart: true, agendaDayEnd: true, timezone: true },
    }),
    resourceId
      ? Promise.resolve(1)
      : prisma.resource.count({ where: { clinicId, isActive: true, kind: "CHAIR" } }),
    prisma.appointment.findMany({
      where: {
        clinicId,
        startsAt: { gte: from, lte: to },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        ...(resourceId ? { resourceId } : {}),
        ...(doctorId ? { doctorId } : {}),
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  if (!clinic) return NextResponse.json({ error: "clinic_not_found" }, { status: 404 });

  const dayStart = clinic.agendaDayStart;
  const dayEnd = clinic.agendaDayEnd;
  const hours: number[] = [];
  for (let h = dayStart; h < dayEnd; h++) hours.push(h);

  // Contadores de slots por (día semana, hora). dayIdx 0=Lunes, 6=Domingo.
  const slotCount: number[][] = Array.from({ length: 7 }, () => Array(hours.length).fill(0));
  // numWeeks por columna para computar % avg = totalCount / (chairs * weeks).
  // Usamos un set de (year-week) para contar semanas únicas que tocaron
  // cada slot.
  const weeksSet = new Set<string>();

  for (const a of appts) {
    const d = new Date(a.startsAt);
    const dayOfWeek = (d.getDay() + 6) % 7; // Lun=0
    const hour = d.getHours();
    const idx = hour - dayStart;
    if (idx < 0 || idx >= hours.length) continue;
    slotCount[dayOfWeek]![idx]! += 1;

    const week = `${d.getFullYear()}-${getWeekNumber(d)}`;
    weeksSet.add(week);
  }

  const weeks = Math.max(1, weeksSet.size);
  const heatmap: Array<Array<{ value: number; count: number }>> = slotCount.map((row) =>
    row.map((count) => {
      const denom = totalChairs * weeks;
      const value = denom > 0 ? Math.round((count / denom) * 100) : 0;
      return { value, count };
    }),
  );

  // Insights derivados: sillón más infrautilizado y slot pico.
  const totalByResource = resourceId ? null : await prisma.appointment.groupBy({
    by: ["resourceId"],
    where: {
      clinicId,
      startsAt: { gte: from, lte: to },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      resourceId: { not: null },
    },
    _count: { id: true },
  });

  let leastUsedResource: { id: string; name: string; pct: number } | null = null;
  if (totalByResource && totalByResource.length > 0) {
    const totalAppts = totalByResource.reduce((s, r) => s + r._count.id, 0);
    const sorted = [...totalByResource].sort((a, b) => a._count.id - b._count.id);
    const least = sorted[0];
    if (least && least.resourceId && totalAppts > 0) {
      const r = await prisma.resource.findFirst({
        where: { id: least.resourceId, clinicId },
        select: { id: true, name: true },
      });
      if (r) {
        leastUsedResource = {
          id: r.id,
          name: r.name,
          pct: Math.round((least._count.id / totalAppts) * 100),
        };
      }
    }
  }

  return NextResponse.json({
    heatmap,
    hours,
    weeks,
    totalChairs,
    insights: {
      leastUsedResource,
      totalAppts: appts.length,
    },
  });
}

function getWeekNumber(d: Date): number {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}
