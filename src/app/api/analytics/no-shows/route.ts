import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/no-shows?from=&to=
 *
 * Stats de no-shows de la clínica:
 *  - rate: % no-shows del total
 *  - byDayOfWeek: array de 7 con count y rate por día
 *  - byHour: array de horas operativas con count
 *  - topPatients: pacientes con más no-shows en el rango
 *  - upcomingHighRisk: citas futuras con probability >= 0.6 desde
 *    NoShowPrediction (si existe predicción)
 *
 * Multi-tenant: clinicId siempre desde getCurrentUser, todas las queries
 * filtran por él directamente (appointments) o vía relation
 * (no_show_predictions → appointment → clinicId).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [appts, upcomingPredictions] = await Promise.all([
    prisma.appointment.findMany({
      where: { clinicId, startsAt: { gte: from, lte: to } },
      select: {
        id: true,
        status: true,
        startsAt: true,
        patient: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.noShowPrediction.findMany({
      where: {
        // Filtro tenant vía relation: la predicción no tiene clinicId
        // directo, pero su appointment sí.
        appointment: { clinicId, startsAt: { gte: new Date() } },
        probability: { gte: 0.6 },
      },
      select: {
        appointmentId: true,
        probability: true,
        factors: true,
        appointment: {
          select: {
            id: true,
            startsAt: true,
            type: true,
            patient: { select: { firstName: true, lastName: true } },
            doctor: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { probability: "desc" },
      take: 10,
    }),
  ]);

  const total = appts.length;
  const noShows = appts.filter((a) => a.status === "NO_SHOW");
  const rate = total > 0 ? Math.round((noShows.length / total) * 1000) / 10 : 0;

  // By day of week (0=Lun, 6=Dom).
  const byDayCount = Array(7).fill(0);
  const byDayTotal = Array(7).fill(0);
  for (const a of appts) {
    const dow = (new Date(a.startsAt).getDay() + 6) % 7;
    byDayTotal[dow] += 1;
    if (a.status === "NO_SHOW") byDayCount[dow] += 1;
  }
  const byDayOfWeek = byDayCount.map((count, i) => ({
    dayIdx: i,
    count,
    total: byDayTotal[i],
    rate: byDayTotal[i] > 0 ? Math.round((count / byDayTotal[i]) * 1000) / 10 : 0,
  }));

  // By hour.
  const byHourMap = new Map<number, { count: number; total: number }>();
  for (const a of appts) {
    const h = new Date(a.startsAt).getHours();
    const entry = byHourMap.get(h) ?? { count: 0, total: 0 };
    entry.total += 1;
    if (a.status === "NO_SHOW") entry.count += 1;
    byHourMap.set(h, entry);
  }
  const byHour = Array.from(byHourMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([hour, { count, total }]) => ({
      hour,
      count,
      total,
      rate: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }));

  // Top patients with most no-shows.
  const byPatient = new Map<string, { name: string; count: number }>();
  for (const a of noShows) {
    if (!a.patient) continue;
    const key = a.patient.id;
    const name = `${a.patient.firstName} ${a.patient.lastName}`;
    const e = byPatient.get(key) ?? { name, count: 0 };
    e.count += 1;
    byPatient.set(key, e);
  }
  const topPatients = Array.from(byPatient.entries())
    .map(([id, { name, count }]) => ({ id, name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    total,
    noShowCount: noShows.length,
    rate,
    byDayOfWeek,
    byHour,
    topPatients,
    upcomingHighRisk: upcomingPredictions.map((p) => ({
      appointmentId: p.appointmentId,
      probability: p.probability,
      factors: p.factors,
      startsAt: p.appointment.startsAt.toISOString(),
      type: p.appointment.type,
      patient: p.appointment.patient
        ? `${p.appointment.patient.firstName} ${p.appointment.patient.lastName}`
        : "—",
      doctor: p.appointment.doctor
        ? `${p.appointment.doctor.firstName} ${p.appointment.doctor.lastName}`
        : "—",
    })),
  });
}
