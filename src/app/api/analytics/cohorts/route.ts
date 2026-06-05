import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MS_MONTH = 30 * 24 * 60 * 60 * 1000;
const MILESTONES = [1, 3, 6, 12];

/**
 * GET /api/analytics/cohorts
 *
 * Retención por cohorte: agrupa pacientes por mes de alta (createdAt) y
 * calcula el % que sigue activo (con cita no cancelada) a 1/3/6/12 meses.
 * Un milestone solo cuenta si la cohorte ya tiene esa antigüedad (eligible).
 *
 * Multi-tenant: clinicId SIEMPRE desde getCurrentUser. Admin/owner only.
 */
export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  const patients = await prisma.patient.findMany({
    where: { clinicId, deletedAt: null },
    select: {
      createdAt: true,
      appointments: { select: { startsAt: true, status: true } },
    },
    take: 10000,
  });

  const now = Date.now();
  const cohorts = new Map<
    string,
    { signups: number; retained: Record<number, number>; eligible: Record<number, number> }
  >();

  for (const p of patients) {
    const created = new Date(p.createdAt);
    const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
    let c = cohorts.get(key);
    if (!c) {
      c = { signups: 0, retained: {}, eligible: {} };
      for (const m of MILESTONES) { c.retained[m] = 0; c.eligible[m] = 0; }
      cohorts.set(key, c);
    }
    c.signups++;

    let lastActivity = 0;
    for (const a of p.appointments) {
      if (a.status === "CANCELLED") continue;
      const ts = new Date(a.startsAt).getTime();
      if (ts > lastActivity) lastActivity = ts;
    }
    const ageMonths = (now - created.getTime()) / MS_MONTH;
    for (const m of MILESTONES) {
      if (ageMonths >= m) {
        c.eligible[m]++;
        if (lastActivity >= created.getTime() + m * MS_MONTH) c.retained[m]++;
      }
    }
  }

  const result = Array.from(cohorts.entries())
    .map(([month, c]) => ({
      month,
      signups: c.signups,
      retention: MILESTONES.map((m) => ({
        month: m,
        eligible: c.eligible[m],
        retained: c.retained[m],
        pct: c.eligible[m] > 0 ? Math.round((c.retained[m] / c.eligible[m]) * 100) : null,
      })),
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);

  return NextResponse.json({ cohorts: result, milestones: MILESTONES });
}
