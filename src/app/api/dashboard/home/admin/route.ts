import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { daysUntil, isInTrial } from "@/lib/plan-status";
import {
  loadClinicSession,
  requireRole,
} from "@/lib/agenda/api-helpers";
import { aggregateAdminPeriodKpis } from "@/lib/agenda/server";
import {
  periodRangeUtc,
  getTzParts,
  tzLocalToUtc,
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
      buildAlerts(session.clinic.id, session.clinic),
      buildTeamPerformance(period, session.clinic.id, session.clinic.timezone, session.clinic.category),
    ]);

  const data: HomeAdminData = {
    period,
    kpis: [
      // El comparativo de ingresos va contra el MISMO TRAMO del periodo
      // anterior (ver aggregatePreviousPeriodKpis): el dinero se acumula con el
      // calendario, así que medir 2 días contra un mes entero daba siempre un
      // "-97%" que no significaba nada. Los conteos de citas sí se comparan
      // periodo completo contra periodo completo: una cita futura ya está
      // agendada y cuenta desde hoy.
      formatRevenueKpi(kpisCurrent.revenueMXN, kpisPrev.revenueSamePartMXN, period),
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
    delta: deltaPct(current, prev, `vs mismo periodo del ${periodLabel(period)} anterior`),
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
    delta: deltaPct(current, prev, `vs ${periodLabel(period)} anterior`),
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

/** `sub` es el texto COMPLETO que va bajo el porcentaje ("vs …"). */
function deltaPct(
  current: number,
  prev: number,
  sub: string,
): { value: string; direction: "up" | "down"; sub: string } | undefined {
  if (prev === 0) return undefined;
  const pct = ((current - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return undefined;
  return {
    value: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`,
    direction: pct >= 0 ? "up" : "down",
    sub,
  };
}

function periodLabel(p: AdminPeriod): string {
  return p === "day" ? "día" : p === "month" ? "mes" : p === "quarter" ? "trimestre" : "año";
}

/**
 * KPIs del periodo ANTERIOR, con dos ventanas distintas a propósito:
 *
 *  - Conteos (citas, completadas, no-shows): periodo anterior COMPLETO. Una
 *    cita futura ya está agendada, así que el periodo en curso también se
 *    cuenta completo y la comparación es pareja.
 *  - Ingresos (`revenueSamePartMXN`): sólo el MISMO TRAMO ya transcurrido. El
 *    dinero entra con el calendario: comparar los 2 días que van del mes contra
 *    los 30 del mes pasado daba un "-97%" garantizado cada día 2, que se leía
 *    como una caída del negocio en vez de como el mes recién empezado.
 */
async function aggregatePreviousPeriodKpis(
  period: AdminPeriod,
  clinicId: string,
  timezone: string,
) {
  const { from, to } = periodRangeUtc(period, timezone);
  const length = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - length);
  const prevTo = from;
  // Tramo ya corrido del periodo actual, proyectado sobre el anterior.
  const elapsed = Math.max(0, Math.min(Date.now(), to.getTime()) - from.getTime());
  const prevSameTo = new Date(Math.min(prevFrom.getTime() + elapsed, prevTo.getTime()));

  const [appts, completed, noShows, invoicedSamePart] = await Promise.all([
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
        paidAt: { gte: prevFrom, lt: prevSameTo },
        method: { not: "refund" },
      },
      _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: null as number | null } })),
  ]);

  return {
    appointments: appts,
    completed,
    noShows,
    revenueSamePartMXN: Number(invoicedSamePart._sum.amount ?? 0),
  };
}

/**
 * Ingresos de los últimos 6 meses (el actual incluido) para el sparkline de la
 * tarjeta de ingresos. Antes eran 6 `aggregate` EN SERIE — seis viajes a la
 * base en cada carga del home. Ahora es una query y el agrupamiento se hace en
 * JS por clave de mes en la zona de la clínica (a prueba de husos y DST), el
 * mismo patrón que la serie de la gráfica.
 */
async function buildRevenueSeries(
  clinicId: string,
  timezone: string,
): Promise<HomeAdminData["revenueSeries"]> {
  const now = new Date();
  const np = getTzParts(now, timezone);

  const months: Array<{ key: string; month: string }> = [];
  for (let i = 5; i >= 0; i--) {
    const ref = new Date(Date.UTC(np.year, np.month - 1 - i, 15, 12));
    const y = ref.getUTCFullYear();
    const m = ref.getUTCMonth() + 1;
    months.push({
      key: `${y}-${pad2(m)}`,
      month: new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", month: "short" })
        .format(ref)
        .replace(".", "")
        .replace(/^./, (c) => c.toUpperCase()),
    });
  }

  const firstMonth = new Date(Date.UTC(np.year, np.month - 1 - 5, 1, 12));
  const from = tzLocalToUtc(
    `${firstMonth.getUTCFullYear()}-${pad2(firstMonth.getUTCMonth() + 1)}-01`,
    0,
    0,
    timezone,
  );
  // Igual que el KPI y que la gráfica: la ventana llega al FIN del mes en
  // curso, no a "ahora".
  const { to } = periodRangeUtc("month", timezone, now);

  const payments = await prisma.payment
    .findMany({
      where: {
        invoice: { clinicId, status: { notIn: ["CANCELLED"] } },
        paidAt: { gte: from, lt: to },
        method: { not: "refund" },
      },
      select: { amount: true, paidAt: true },
    })
    .catch((err) => {
      console.error("[home admin] revenue series query failed:", err);
      return [] as Array<{ amount: number; paidAt: Date | null }>;
    });

  const sums: Record<string, number> = {};
  for (const p of payments) {
    if (!p.paidAt) continue;
    const tp = getTzParts(p.paidAt, timezone);
    const key = `${tp.year}-${pad2(tp.month)}`;
    sums[key] = (sums[key] ?? 0) + Number(p.amount ?? 0);
  }

  return months.map((m) => ({ month: m.month, value: sums[m.key] ?? 0 }));
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

async function buildAlerts(
  clinicId: string,
  clinic: { trialEndsAt: Date | null; subscriptionStatus: string | null },
): Promise<HomeAdminAlert[]> {
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

  // Trial vencimiento — SOLO con trial/cortesía VIGENTE (fuente única
  // plan-status). Una clínica que PAGA tiene trialEndsAt = fin del periodo
  // pagado y no debe leer "Prueba vence en N días" cada mes. Los datos vienen
  // de session.clinic (loadClinicSession), sin findUnique redundante.
  const days = isInTrial(clinic) ? daysUntil(clinic.trialEndsAt) : null;
  if (days !== null && days > 0 && days <= 14) {
    alerts.push({
      id: "trial",
      tone: days <= 3 ? "danger" : "warning",
      title: `Prueba vence en ${days} día${days === 1 ? "" : "s"}`,
      href: "/dashboard/settings?tab=subscription",
    });
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
