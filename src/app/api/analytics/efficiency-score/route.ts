import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/efficiency-score?date=2026-04-28
 *
 * Score = (% horas activas) * 0.6 + (% slots usados) * 0.4
 * - "horas activas" = suma de duraciones de citas con status COMPLETED
 *   o IN_PROGRESS o CHECKED_OUT en el día.
 * - "horas operativas" = (agendaDayEnd - agendaDayStart) horas × #doctores
 *   activos.
 * - "slots usados" = citas no canceladas / no-show.
 * - "slots totales" = horas operativas / (defaultSlotMinutes / 60).
 *
 * Devuelve { score, today, monthAverage, hint }.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const day = dateParam ? new Date(dateParam) : new Date();
  day.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { agendaDayStart: true, agendaDayEnd: true, defaultSlotMinutes: true },
  });
  if (!clinic) return NextResponse.json({ error: "clinic_not_found" }, { status: 404 });

  const operativeHoursPerDoctor = Math.max(0, clinic.agendaDayEnd - clinic.agendaDayStart);
  const slotMinutes = clinic.defaultSlotMinutes ?? 15;

  const [activeDoctors, todayAppts] = await Promise.all([
    prisma.user.count({
      where: { clinicId, isActive: true, agendaActive: true, role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] } },
    }),
    prisma.appointment.findMany({
      where: { clinicId, startsAt: { gte: day, lte: dayEnd } },
      select: { startsAt: true, endsAt: true, status: true },
    }),
  ]);

  const score = computeScore(todayAppts, activeDoctors, operativeHoursPerDoctor, slotMinutes);
  const monthAverage = await computeMonthAverage(clinicId, day, activeDoctors, operativeHoursPerDoctor, slotMinutes);

  return NextResponse.json({
    score,
    today: score,
    monthAverage,
    activeDoctors,
    operativeHoursPerDoctor,
  });
}

function computeScore(
  appts: Array<{ startsAt: Date; endsAt: Date; status: string }>,
  activeDoctors: number,
  operativeHoursPerDoctor: number,
  slotMinutes: number,
): number {
  if (activeDoctors === 0 || operativeHoursPerDoctor === 0) return 0;

  const activeStatuses = new Set(["IN_PROGRESS", "COMPLETED", "CHECKED_OUT", "CHECKED_IN", "IN_CHAIR"]);
  const usedStatuses = new Set([
    "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT",
  ]);

  const totalActiveMs = appts
    .filter((a) => activeStatuses.has(a.status))
    .reduce((sum, a) => sum + (a.endsAt.getTime() - a.startsAt.getTime()), 0);
  const totalActiveHours = totalActiveMs / 3_600_000;

  const totalOperativeHours = activeDoctors * operativeHoursPerDoctor;
  const hourPct = Math.min(100, (totalActiveHours / totalOperativeHours) * 100);

  const usedSlots = appts.filter((a) => usedStatuses.has(a.status)).length;
  const totalSlots = (totalOperativeHours * 60) / slotMinutes;
  const slotPct = totalSlots > 0 ? Math.min(100, (usedSlots / totalSlots) * 100) : 0;

  return Math.round(hourPct * 0.6 + slotPct * 0.4);
}

async function computeMonthAverage(
  clinicId: string,
  refDay: Date,
  activeDoctors: number,
  operativeHoursPerDoctor: number,
  slotMinutes: number,
): Promise<number> {
  const monthStart = new Date(refDay.getFullYear(), refDay.getMonth(), 1);
  const monthEnd = new Date(refDay.getFullYear(), refDay.getMonth() + 1, 0, 23, 59, 59);

  const monthAppts = await prisma.appointment.findMany({
    where: { clinicId, startsAt: { gte: monthStart, lte: monthEnd } },
    select: { startsAt: true, endsAt: true, status: true },
  });

  // Agrupa por día y calcula score por día, luego promedia.
  const byDay = new Map<string, typeof monthAppts>();
  for (const a of monthAppts) {
    const key = a.startsAt.toISOString().slice(0, 10);
    const arr = byDay.get(key) ?? [];
    arr.push(a);
    byDay.set(key, arr);
  }
  if (byDay.size === 0) return 0;

  let total = 0;
  let dayCount = 0;
  byDay.forEach((dayAppts) => {
    total += computeScore(dayAppts, activeDoctors, operativeHoursPerDoctor, slotMinutes);
    dayCount += 1;
  });
  return dayCount > 0 ? Math.round(total / dayCount) : 0;
}
