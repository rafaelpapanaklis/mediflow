import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/journey?from=&to=
 *
 * Devuelve el flujo de citas por estado final + tiempos promedio entre
 * etapas (de AppointmentTimeline):
 *
 *  Etapas medidas:
 *   - Llegada (arrivedAt)
 *   - Espera (arrivedAt → inChairAt) avgWait
 *   - En sillón (inChairAt → consultStartAt) avgInChair
 *   - Consulta (consultStartAt → consultEndAt) avgConsult
 *   - Checkout (consultEndAt → checkoutAt) avgCheckout
 *
 *  Drop-offs por estado terminal:
 *   - SCHEDULED/CONFIRMED → CANCELLED (cancelled before arrival)
 *   - SCHEDULED/CONFIRMED/CHECKED_IN → NO_SHOW (no llegó)
 *
 *  Funnel: counts en cada etapa para el flow chart.
 *
 * Multi-tenant: appointments.clinicId directo. AppointmentTimeline vía
 * relation (where: { appointment: { clinicId } }).
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
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Funnel: una sola query a appointments con conteo por status.
  const appts = await prisma.appointment.findMany({
    where: { clinicId, startsAt: { gte: from, lte: to } },
    select: { id: true, status: true },
  });

  const totalAppts = appts.length;
  const statusCounts = {
    scheduled:  appts.filter((a) => a.status === "SCHEDULED" || a.status === "CONFIRMED").length,
    cancelled:  appts.filter((a) => a.status === "CANCELLED").length,
    noShow:     appts.filter((a) => a.status === "NO_SHOW").length,
    arrived:    appts.filter((a) => ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT"].includes(a.status)).length,
    inChair:    appts.filter((a) => ["IN_CHAIR", "IN_PROGRESS", "COMPLETED", "CHECKED_OUT"].includes(a.status)).length,
    inProgress: appts.filter((a) => ["IN_PROGRESS", "COMPLETED", "CHECKED_OUT"].includes(a.status)).length,
    completed:  appts.filter((a) => a.status === "COMPLETED" || a.status === "CHECKED_OUT").length,
    checkedOut: appts.filter((a) => a.status === "CHECKED_OUT").length,
  };

  // Tiempos promedio por etapa — desde AppointmentTimeline.
  const timelines = await prisma.appointmentTimeline.findMany({
    where: { appointment: { clinicId, startsAt: { gte: from, lte: to } } },
    select: {
      arrivedAt: true,
      inChairAt: true,
      consultStartAt: true,
      consultEndAt: true,
      checkoutAt: true,
    },
  });

  function avgMinBetween(
    items: Array<{ a?: Date | null; b?: Date | null }>,
    aKey: keyof typeof items[0],
    bKey: keyof typeof items[0],
  ): { avgMin: number; sample: number } {
    const diffs: number[] = [];
    for (const item of items) {
      const aVal = item[aKey] as Date | null | undefined;
      const bVal = item[bKey] as Date | null | undefined;
      if (!aVal || !bVal) continue;
      const min = Math.round((bVal.getTime() - aVal.getTime()) / 60_000);
      if (min < 0 || min > 24 * 60) continue;  // ignora outliers >24h
      diffs.push(min);
    }
    if (diffs.length === 0) return { avgMin: 0, sample: 0 };
    return {
      avgMin: Math.round(diffs.reduce((s, n) => s + n, 0) / diffs.length),
      sample: diffs.length,
    };
  }

  const stages = [
    {
      id: "wait",
      label: "Espera",
      from: "Llegada (CHECKED_IN)",
      to: "En sillón (IN_CHAIR)",
      ...avgMinBetween(
        timelines.map((t) => ({ a: t.arrivedAt, b: t.inChairAt })),
        "a", "b",
      ),
    },
    {
      id: "in-chair",
      label: "En sillón",
      from: "En sillón (IN_CHAIR)",
      to: "Inicio consulta (IN_PROGRESS)",
      ...avgMinBetween(
        timelines.map((t) => ({ a: t.inChairAt, b: t.consultStartAt })),
        "a", "b",
      ),
    },
    {
      id: "consult",
      label: "Consulta",
      from: "Inicio (IN_PROGRESS)",
      to: "Fin (COMPLETED)",
      ...avgMinBetween(
        timelines.map((t) => ({ a: t.consultStartAt, b: t.consultEndAt })),
        "a", "b",
      ),
    },
    {
      id: "checkout",
      label: "Checkout",
      from: "Fin consulta",
      to: "Salida (CHECKED_OUT)",
      ...avgMinBetween(
        timelines.map((t) => ({ a: t.consultEndAt, b: t.checkoutAt })),
        "a", "b",
      ),
    },
  ];

  // Identifica etapa con mayor avg (cuello de botella).
  const bottleneck = [...stages].filter((s) => s.sample > 0).sort((a, b) => b.avgMin - a.avgMin)[0] ?? null;

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    totalAppts,
    funnel: [
      { id: "scheduled",  label: "Programadas",   count: totalAppts },
      { id: "arrived",    label: "Llegaron",      count: statusCounts.arrived },
      { id: "in-chair",   label: "En sillón",     count: statusCounts.inChair },
      { id: "consult",    label: "En consulta",   count: statusCounts.inProgress },
      { id: "completed",  label: "Completadas",   count: statusCounts.completed },
      { id: "checkout",   label: "Checked-out",   count: statusCounts.checkedOut },
    ],
    dropOffs: {
      cancelled: statusCounts.cancelled,
      noShow: statusCounts.noShow,
    },
    stages,
    bottleneck,
  });
}
