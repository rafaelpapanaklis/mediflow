import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  loadClinicSession,
  requireRole,
} from "@/lib/agenda/api-helpers";
import { aggregateAdminPeriodKpis } from "@/lib/agenda/server";
import {
  periodRangeUtc,
  type AdminPeriod,
} from "@/lib/agenda/time-utils";
import type {
  HomeAdminData,
  HomeAdminAlert,
  HomeAdminTeamRow,
} from "@/lib/home/types";

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, ["ADMIN", "SUPER_ADMIN"]);
  if (forbidden) return forbidden;

  const periodParam = req.nextUrl.searchParams.get("period");
  const period: AdminPeriod = isValidPeriod(periodParam) ? periodParam : "month";

  const [kpisCurrent, kpisPrev, revenueSeries, alerts, team] =
    await Promise.all([
      aggregateAdminPeriodKpis(period, session.clinic.id, session.clinic.timezone),
      aggregatePreviousPeriodKpis(period, session.clinic.id, session.clinic.timezone),
      buildRevenueSeries(session.clinic.id, session.clinic.timezone),
      buildAlerts(session.clinic.id, session.clinic.trialEndsAt ?? null),
      buildTeamPerformance(period, session.clinic.id, session.clinic.timezone, session.clinic.category),
    ]);

  const data: HomeAdminData = {
    period,
    kpis: [
      formatRevenueKpi(kpisCurrent.revenueMXN, kpisPrev.revenueMXN, period),
      formatCountKpi("Citas", kpisCurrent.appointments, kpisPrev.appointments, period),
      formatOccupancyKpi(kpisCurrent, kpisPrev),
      formatNoShowKpi(kpisCurrent.noShows, kpisPrev.noShows, period),
    ],
    revenueSeries,
    alerts,
    team,
  };

  return NextResponse.json(data);
}

function isValidPeriod(s: string | null): s is AdminPeriod {
  return s === "day" || s === "month" || s === "quarter" || s === "year";
}

function formatRevenueKpi(
  current: number,
  prev: number,
  period: AdminPeriod,
): HomeAdminData["kpis"][number] {
  const label =
    period === "day" ? "Ingresos del día"
    : period === "month" ? "Ingresos del mes"
    : period === "quarter" ? "Ingresos del trimestre"
    : "Ingresos del año";
  return {
    label,
    value: `$${current.toLocaleString("es-MX", { maximumFractionDigits: 0 })}`,
    delta: deltaPct(current, prev, periodLabel(period)),
  };
}

function formatCountKpi(
  label: string,
  current: number,
  prev: number,
  period: AdminPeriod,
): HomeAdminData["kpis"][number] {
  return {
    label,
    value: current.toString(),
    delta: deltaPct(current, prev, periodLabel(period)),
  };
}

function formatOccupancyKpi(
  current: { completed: number; appointments: number },
  prev: { completed: number; appointments: number },
): HomeAdminData["kpis"][number] {
  const pct = current.appointments > 0
    ? Math.round((current.completed / current.appointments) * 100)
    : 0;
  const prevPct = prev.appointments > 0
    ? Math.round((prev.completed / prev.appointments) * 100)
    : 0;
  const diff = pct - prevPct;
  return {
    label: "Ocupación",
    value: `${pct}%`,
    delta: diff !== 0
      ? {
          value: `${diff > 0 ? "+" : ""}${diff}%`,
          direction: diff >= 0 ? "up" : "down",
        }
      : undefined,
  };
}

function formatNoShowKpi(
  current: number,
  prev: number,
  period: AdminPeriod,
): HomeAdminData["kpis"][number] {
  const diff = current - prev;
  return {
    label: "No-shows",
    value: current.toString(),
    delta: diff !== 0
      ? {
          value: `${diff > 0 ? "+" : ""}${diff}`,
          direction: diff <= 0 ? "up" : "down",
          sub: `vs ${periodLabel(period)} anterior`,
        }
      : undefined,
  };
}

function deltaPct(
  current: number,
  prev: number,
  pLabel: string,
): { value: string; direction: "up" | "down"; sub: string } | undefined {
  if (prev === 0) return undefined;
  const pct = ((current - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return undefined;
  return {
    value: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`,
    direction: pct >= 0 ? "up" : "down",
    sub: `vs ${pLabel} anterior`,
  };
}

function periodLabel(p: AdminPeriod): string {
  return p === "day" ? "día" : p === "month" ? "mes" : p === "quarter" ? "trimestre" : "año";
}

async function aggregatePreviousPeriodKpis(
  period: AdminPeriod,
  clinicId: string,
  timezone: string,
) {
  const { from, to } = periodRangeUtc(period, timezone);
  const length = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - length);
  const prevTo = from;

  const [appts, completed, noShows, invoiced] = await Promise.all([
    prisma.appointment.count({
      where: {
        clinicId,
        startsAt: { gte: prevFrom, lt: prevTo },
        status: { notIn: ["CANCELLED"] },
      },
    }),
    prisma.appointment.count({
      where: {
        clinicId,
        startsAt: { gte: prevFrom, lt: prevTo },
        status: "COMPLETED",
      },
    }),
    prisma.appointment.count({
      where: {
        clinicId,
        startsAt: { gte: prevFrom, lt: prevTo },
        status: "NO_SHOW",
      },
    }),
    prisma.payment.aggregate({
      where: {
        invoice: { clinicId, status: { notIn: ["CANCELLED"] } },
        paidAt: { gte: prevFrom, lt: prevTo },
        method: { not: "refund" },
      },
      _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: null as number | null } })),
  ]);

  return {
    appointments: appts,
    completed,
    noShows,
    revenueMXN: Number(invoiced._sum.amount ?? 0),
  };
}

async function buildRevenueSeries(
  clinicId: string,
  timezone: string,
): Promise<HomeAdminData["revenueSeries"]> {
  const now = new Date();
  const out: HomeAdminData["revenueSeries"] = [];

  for (let i = 5; i >= 0; i--) {
    const ref = new Date(now.getTime());
    ref.setMonth(ref.getMonth() - i);
    const { from, to } = periodRangeUtc("month", timezone, ref);

    const agg = await prisma.payment.aggregate({
      where: {
        invoice: { clinicId, status: { notIn: ["CANCELLED"] } },
        paidAt: { gte: from, lt: to },
        method: { not: "refund" },
      },
      _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: null as number | null } }));

    const monthLabel = new Intl.DateTimeFormat("es-MX", {
      timeZone: timezone,
      month: "short",
    })
      .format(from)
      .replace(".", "")
      .replace(/^./, (c) => c.toUpperCase());

    out.push({
      month: monthLabel,
      value: Number(agg._sum.amount ?? 0),
    });
  }

  return out;
}

async function buildAlerts(clinicId: string, trialEndsAt: Date | null): Promise<HomeAdminAlert[]> {
  const alerts: HomeAdminAlert[] = [];

  // Inventario bajo (quantity <= minQuantity)
  try {
    const lowStock = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "inventory_items"
      WHERE "clinicId" = ${clinicId}
        AND "quantity" <= "minQuantity"
    `;
    const n = Number(lowStock[0]?.count ?? 0);
    if (n > 0) {
      alerts.push({
        id: "inv-low",
        tone: "danger",
        title: `Inventario crítico: ${n} insumo${n === 1 ? "" : "s"} bajo nivel`,
        href: "/dashboard/inventory?filter=low",
      });
    }
  } catch (err) {
    console.error("[admin alerts] lowStock query failed:", err);
    /* skip — la alerta se omite, no rompemos el endpoint */
  }

  // Facturas vencidas
  try {
    const now = new Date();
    const rows = await prisma.invoice.findMany({
      where: {
        clinicId,
        status: { notIn: ["CANCELLED"] },
        dueDate: { lt: now },
      },
      select: { total: true, paid: true },
    });
    let count = 0;
    let total = 0;
    for (const r of rows) {
      const remaining = Number(r.total) - Number(r.paid ?? 0);
      if (remaining > 0) {
        count += 1;
        total += remaining;
      }
    }
    if (count > 0) {
      alerts.push({
        id: "inv-overdue",
        tone: "warning",
        title: `${count} factura${count === 1 ? "" : "s"} vencida${count === 1 ? "" : "s"} · $${total.toLocaleString("es-MX", { maximumFractionDigits: 0 })}`,
        href: "/dashboard/billing?filter=overdue",
      });
    }
  } catch (err) {
    console.error("[admin alerts] overdue invoices query failed:", err);
    /* skip — la alerta se omite, no rompemos el endpoint */
  }

  // Trial vencimiento — recibimos trialEndsAt del session.clinic (loadClinicSession
  // ya hace include: { clinic: true }), evitamos un findUnique redundante.
  if (trialEndsAt) {
    const days = Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000);
    if (days > 0 && days <= 14) {
      alerts.push({
        id: "trial",
        tone: days <= 3 ? "danger" : "warning",
        title: `Prueba vence en ${days} día${days === 1 ? "" : "s"}`,
        href: "/dashboard/settings?tab=subscription",
      });
    }
  }

  return alerts;
}

/**
 * Team performance: revenueMXN por doctor degradado a 0 — Invoice no tiene
 * doctorId en el schema. Citas y completionPct sí se calculan correctamente.
 *
 * Antes: N+1 — un loop sobre doctores hacía 2 count() por cada uno (5
 * doctores → 10 queries serie). Ahora: 2 queries fijas (doctors + groupBy
 * de appointments por doctorId+status), independiente del N.
 */
async function buildTeamPerformance(
  period: AdminPeriod,
  clinicId: string,
  timezone: string,
  category: string,
): Promise<HomeAdminTeamRow[]> {
  const { from, to } = periodRangeUtc(period, timezone);

  const [doctors, grouped] = await Promise.all([
    prisma.user.findMany({
      where: { clinicId, role: "DOCTOR", isActive: true },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.appointment.groupBy({
      by: ["doctorId", "status"],
      where: {
        clinicId,
        startsAt: { gte: from, lt: to },
        status: { notIn: ["CANCELLED"] },
      },
      _count: { _all: true },
    }),
  ]);

  // Agregamos por doctorId: total appts + completed appts.
  const totals = new Map<string, { appts: number; completed: number }>();
  for (const row of grouped) {
    const cur = totals.get(row.doctorId) ?? { appts: 0, completed: 0 };
    cur.appts += row._count._all;
    if (row.status === "COMPLETED") cur.completed += row._count._all;
    totals.set(row.doctorId, cur);
  }

  const rows: HomeAdminTeamRow[] = doctors.map((d) => {
    const t = totals.get(d.id) ?? { appts: 0, completed: 0 };
    return {
      userId: d.id,
      doctorName: shortName(d.firstName, category),
      appointments: t.appts,
      completionPct: t.appts > 0 ? Math.round((t.completed / t.appts) * 100) : 0,
      revenueMXN: 0,
    };
  });

  return rows.sort((a, b) => b.appointments - a.appointments);
}

const NON_MEDICAL = [
  "SPA",
  "MASSAGE",
  "BEAUTY_CENTER",
  "NAIL_SALON",
  "HAIR_SALON",
  "BROW_LASH",
  "LASER_HAIR_REMOVAL",
];

function shortName(firstName: string, category: string): string {
  const first = firstName.split(/\s+/)[0] ?? firstName;
  return NON_MEDICAL.includes(category) ? first : `Dr. ${first}`;
}
