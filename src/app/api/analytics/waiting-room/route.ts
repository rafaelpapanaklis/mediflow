import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/waiting-room?from=&to=&threshold=20
 *
 * Reportes de tiempo de espera basados en AppointmentTimeline:
 *  - byHour[]: avg waitMin por hora del día (heatmap data).
 *  - byDayOfWeek[][]: matriz 7×N (día × hora) con avg waitMin.
 *  - longWaits[]: citas EN CURSO con totalWaitMin > threshold (alertas).
 *  - overallAvg, overallMedian.
 *
 * Multi-tenant: appointment_timelines NO tiene clinicId directo.
 * Filtramos vía relation: where: { appointment: { clinicId } } en
 * todas las queries que tocan la tabla.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN", "RECEPTIONIST", "DOCTOR"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const thresholdParam = url.searchParams.get("threshold");
  const threshold = thresholdParam ? Number(thresholdParam) : 20;

  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { agendaDayStart: true, agendaDayEnd: true },
  });
  if (!clinic) return NextResponse.json({ error: "clinic_not_found" }, { status: 404 });

  const dayStart = clinic.agendaDayStart;
  const dayEnd = clinic.agendaDayEnd;
  const hours: number[] = [];
  for (let h = dayStart; h < dayEnd; h++) hours.push(h);

  // Histórico — appointment_timelines join appointment con clinicId.
  const timelines = await prisma.appointmentTimeline.findMany({
    where: {
      appointment: { clinicId, startsAt: { gte: from, lte: to } },
      totalWaitMin: { not: null },
    },
    select: {
      totalWaitMin: true,
      arrivedAt: true,
      appointment: { select: { startsAt: true } },
    },
  });

  // Por hora.
  const byHourAcc = new Map<number, { sum: number; count: number; long: number }>();
  // Por DOW × hora.
  const byDowHour: Array<Array<{ sum: number; count: number }>> = Array.from({ length: 7 }, () =>
    hours.map(() => ({ sum: 0, count: 0 })),
  );

  const allWaits: number[] = [];
  for (const t of timelines) {
    const wait = t.totalWaitMin!;
    if (wait < 0) continue;
    allWaits.push(wait);

    const startsAt = t.appointment.startsAt;
    const hour = new Date(startsAt).getHours();
    const dow = (new Date(startsAt).getDay() + 6) % 7;
    const hourIdx = hour - dayStart;

    const e = byHourAcc.get(hour) ?? { sum: 0, count: 0, long: 0 };
    e.sum += wait;
    e.count += 1;
    if (wait > threshold) e.long += 1;
    byHourAcc.set(hour, e);

    if (hourIdx >= 0 && hourIdx < hours.length) {
      const cell = byDowHour[dow]![hourIdx]!;
      cell.sum += wait;
      cell.count += 1;
    }
  }

  const byHour = Array.from(byHourAcc.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([hour, { sum, count, long }]) => ({
      hour,
      avgMin: count > 0 ? Math.round(sum / count) : 0,
      count,
      longWaits: long,
    }));

  const heatmap = byDowHour.map((row) =>
    row.map(({ sum, count }) => ({
      value: count > 0 ? Math.round(sum / count) : 0,
      count,
    })),
  );

  // Stats globales.
  allWaits.sort((a, b) => a - b);
  const overallAvg = allWaits.length > 0
    ? Math.round(allWaits.reduce((s, n) => s + n, 0) / allWaits.length)
    : 0;
  const overallMedian = allWaits.length > 0
    ? allWaits[Math.floor(allWaits.length / 2)]!
    : 0;

  // Pacientes esperando AHORA con más de threshold minutos. Filtra por
  // arrivedAt presente, inChairAt null. Usa appointment.clinicId para
  // tenant scope.
  const now = new Date();
  const thresholdAgo = new Date(now.getTime() - threshold * 60_000);

  const longWaits = await prisma.appointmentTimeline.findMany({
    where: {
      appointment: { clinicId },
      arrivedAt: { lte: thresholdAgo, not: null },
      inChairAt: null,
      consultStartAt: null,
    },
    select: {
      appointmentId: true,
      arrivedAt: true,
      appointment: {
        select: {
          id: true,
          type: true,
          patient: { select: { firstName: true, lastName: true } },
          doctor: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { arrivedAt: "asc" },
    take: 20,
  });

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    threshold,
    overallAvg,
    overallMedian,
    sampleSize: allWaits.length,
    hours,
    byHour,
    heatmap,
    longWaits: longWaits.map((l) => {
      const waitedMin = l.arrivedAt ? Math.round((now.getTime() - l.arrivedAt.getTime()) / 60_000) : 0;
      return {
        appointmentId: l.appointmentId,
        waitedMin,
        type: l.appointment.type,
        patient: l.appointment.patient
          ? `${l.appointment.patient.firstName} ${l.appointment.patient.lastName}`
          : "—",
        doctor: l.appointment.doctor
          ? `${l.appointment.doctor.firstName} ${l.appointment.doctor.lastName}`
          : "—",
      };
    }),
  });
}
