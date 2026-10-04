import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { daysUntil, isInTrial } from "@/lib/plan-status";
import {
  loadClinicSession,
  requireRole,
} from "@/lib/agenda/api-helpers";
import { aggregateAdminPeriodKpis } from "@/lib/agenda/server";
import { computeReceivables } from "@/lib/caja";
import { ingresoNetoDelPeriodo, ingresosPorDoctorDelPeriodo, movimientosDelPeriodo } from "@/lib/dinero/ingresos.server";
import { netoDelPeriodo } from "@/lib/dinero/ingresos";
import { ID_SIN_DOCTOR, NOMBRE_SIN_DOCTOR, idsConIngresoFueraDeLista, ingresoSinDoctor } from "@/lib/dinero/por-doctor";
import { citasDelPeriodoWhere } from "@/lib/agenda/citas-del-periodo";
import { cargarOcupacionDelPeriodo } from "@/lib/agenda/ocupacion-del-periodo.server";
import type { OcupacionDelPeriodo } from "@/lib/agenda/ocupacion-del-periodo";
import { getExpiryAlerts } from "@/lib/inventory/lots.server";
import { avisosDeExistencias, contarExistenciasVigentes } from "@/lib/inventory/avisos-existencias";
import { idsSinContar } from "@/lib/inventory/sin-contar.server";
import { nombreDeProfesional } from "@/lib/nombre-profesional";
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

  const [kpisCurrent, kpisPrev, revenueSeries, alerts, team, ocupacion] =
    await Promise.all([
      aggregateAdminPeriodKpis(period, session.clinic.id, session.clinic.timezone),
      aggregatePreviousPeriodKpis(period, session.clinic.id, session.clinic.timezone),
      buildRevenueSeries(session.clinic.id, session.clinic.timezone),
      buildAlerts(session.clinic.id, session.clinic),
      buildTeamPerformance(period, session.clinic.id, session.clinic.timezone, session.clinic.category),
      buildOccupancy(period, session.clinic.id, session.clinic.timezone),
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
      // C-11: «citas del periodo» = el periodo ENTERO de la clínica, sin
      // canceladas (lib/agenda/citas-del-periodo.ts), la misma definición que
      // Finanzas, Analítica y Reportes; la tarjeta lo dice con su «Qué cuenta».
      { ...formatCountKpi("Citas", kpisCurrent.appointments, kpisPrev.appointments, period), queCuenta: "citasDelPeriodo" },
      formatOccupancyKpi(ocupacion.actual, ocupacion.anterior),
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

/**
 * C-26 (decisión 9 de Rafael: «ocupación por horario»): minutos agendados ÷
 * minutos de atención del horario de Ajustes, por cada profesional que recibe
 * citas — la misma cuenta que la barra de la Agenda. Antes era completadas ÷
 * citas (una tasa de asistencia) y contradecía a la Analítica. Sin horario en
 * Ajustes no se inventa: «—». La diferencia contra el periodo anterior va en
 * puntos («+3 pts»), no en un porcentaje de un porcentaje.
 */
function formatOccupancyKpi(
  current: OcupacionDelPeriodo | null,
  prev: OcupacionDelPeriodo | null,
): HomeAdminData["kpis"][number] {
  const pct = current?.porcentaje ?? null;
  const prevPct = prev?.porcentaje ?? null;
  const diff = pct !== null && prevPct !== null ? pct - prevPct : 0;
  return {
    label: "Ocupación",
    value: pct === null ? "—" : `${pct}%`,
    queCuenta: "ocupacion",
    delta: diff !== 0
      ? {
          value: `${diff > 0 ? "+" : ""}${diff} pts`,
          direction: diff >= 0 ? "up" : "down",
        }
      : undefined,
  };
}

/** La ocupación por horario del periodo y del anterior (en fila: cada carga ya hace 3 lecturas en paralelo). Nunca lanza. */
async function buildOccupancy(
  period: AdminPeriod,
  clinicId: string,
  timezone: string,
): Promise<{ actual: OcupacionDelPeriodo | null; anterior: OcupacionDelPeriodo | null }> {
  const { from, to } = periodRangeUtc(period, timezone);
  const prev = periodRangeUtc(period, timezone, new Date(from.getTime() - 1));
  try {
    const actual = await cargarOcupacionDelPeriodo(clinicId, timezone, from, to);
    const anterior = await cargarOcupacionDelPeriodo(clinicId, timezone, prev.from, prev.to);
    return { actual, anterior };
  } catch (err) {
    console.error("[home admin] occupancy query failed:", err);
    return { actual: null, anterior: null };
  }
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
  // C-11: el periodo anterior es el periodo de CALENDARIO anterior (septiembre
  // entero contra octubre entero), igual que la Analítica. Antes era «la misma
  // duración hacia atrás» (31 días antes del 1-oct = 31-ago) y el comparativo
  // de citas daba −52 % aquí y −47 % allá.
  const { from: prevFrom, to: prevTo } = periodRangeUtc(period, timezone, new Date(from.getTime() - 1));
  // Tramo ya corrido del periodo actual, proyectado sobre el anterior.
  const elapsed = Math.max(0, Math.min(Date.now(), to.getTime()) - from.getTime());
  const prevSameTo = new Date(Math.min(prevFrom.getTime() + elapsed, prevTo.getTime()));

  const [appts, completed, noShows, ingresosSamePart] = await Promise.all([
    prisma.appointment.count({ where: citasDelPeriodoWhere(clinicId, prevFrom, prevTo) }),
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
    // El mismo neto que la tarjeta (ws1-t2, lib/dinero): se compara igual con igual.
    ingresoNetoDelPeriodo(clinicId, { gte: prevFrom, lt: prevSameTo })
      .catch(() => ({ neto: 0, cobrado: 0, reembolsos: 0 })),
  ]);

  return {
    appointments: appts,
    completed,
    noShows,
    revenueSamePartMXN: ingresosSamePart.neto,
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

  // Ingresos NETOS por mes con la definición única (ws1-t2, lib/dinero),
  // los mismos de la tarjeta y de Finanzas.
  const movimientos = await movimientosDelPeriodo(clinicId, { gte: from, lt: to })
    .catch((err) => {
      console.error("[home admin] revenue series query failed:", err);
      return { cobros: [], reembolsos: [] };
    });

  const sums = netoDelPeriodo(movimientos.cobros, movimientos.reembolsos, (d) => {
    const tp = getTzParts(d, timezone);
    return `${tp.year}-${pad2(tp.month)}`;
  }).porClave;

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

  // Existencias. ws1-t5 (arreglo): antes era UN aviso, «N insumos bajo
  // nivel», que contaba `quantity <= minQuantity` y metía lo agotado y lo
  // bajo en el mismo saco (109 = 108 agotados + 1 bajo), con un enlace a un
  // filtro donde solo salía 1. Ahora se cuentan por separado —en la misma
  // consulta, sin un viaje más a la base— y cada aviso abre su filtro.
  // H17: lo caducado no cuenta como existencias — se lee UNA vez y sirve para
  // el conteo de stock y para el aviso de lotes caducados de más abajo.
  let porCaducar: Awaited<ReturnType<typeof getExpiryAlerts>>["porCaducar"] = [];
  let caducado: Awaited<ReturnType<typeof getExpiryAlerts>>["caducado"] = [];
  try {
    ({ porCaducar, caducado } = await getExpiryAlerts(clinicId));
  } catch (err) {
    console.error("[admin alerts] expiry alerts query failed:", err);
  }

  try {
    const items = await prisma.inventoryItem.findMany({
      where: { clinicId },
      select: { id: true, quantity: true, minQuantity: true },
    });
    // 12f: lo que nunca se contó no es «agotado» — aviso aparte.
    const sinContar = await idsSinContar(clinicId, items);
    alerts.push(...avisosDeExistencias(contarExistenciasVigentes(items, caducado, sinContar)));
  } catch (err) {
    console.error("[admin alerts] lowStock query failed:", err);
    /* skip — la alerta se omite, no rompemos el endpoint */
  }

  // WS1-T5 — lotes por caducar / caducados (getExpiryAlerts tolera que el SQL
  // de lotes todavía no esté aplicado: devuelve listas vacías).
  if (caducado.length > 0) {
    alerts.push({
      id:    "inv-caducado",
      tone:  "danger",
      title: `Inventario: ${caducado.length} lote${caducado.length === 1 ? "" : "s"} caducado${caducado.length === 1 ? "" : "s"}`,
      href:  "/dashboard/inventory?filter=caducado",
    });
  }
  if (porCaducar.length > 0) {
    alerts.push({
      id:    "inv-por-caducar",
      tone:  "warning",
      title: `Inventario: ${porCaducar.length} lote${porCaducar.length === 1 ? "" : "s"} por caducar`,
      href:  "/dashboard/inventory?filter=por-caducar",
    });
  }

  // Facturas vencidas: el MISMO «Vencido» de Caja, Facturas y Finanzas
  // (`computeReceivables`, ws1-t2): sin borradores ni canceladas, por cuota en
  // las facturas a plazos y con «hoy» en la zona de la clínica. Antes contaba
  // los borradores y el saldo entero de una factura a plazos con fecha pasada.
  try {
    const saldos = await computeReceivables(clinicId, new Date());
    const vencidas = Object.values(saldos.vencidoPorFactura).filter((v) => v > 0.005);
    const count = vencidas.length;
    const total = saldos.vencido;
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
 * Team performance: citas, % completadas e INGRESOS por doctor.
 *
 * Ingresos (ws1-t2, auditoría de uso C-09): antes iban fijos en $0 con la
 * nota «Invoice no tiene doctorId», que dejó de ser cierto. Ahora son lo
 * COBRADO neto del periodo por doctor con la definición única
 * (`ingresosPorDoctorDelPeriodo`, la de «Por doctor» de Finanzas, la
 * Analítica y la nómina). Quien cobró sin estar en la lista (doctor dado de
 * baja, una factura a nombre de alguien con otro rol) sale también, y lo que
 * no es de nadie va en la fila «Sin doctor»: la columna suma los ingresos del
 * periodo, la misma cifra de la tarjeta.
 *
 * Antes: N+1 — un loop sobre doctores hacía 2 count() por cada uno (5
 * doctores → 10 queries serie). Ahora: 3 queries fijas (doctors + groupBy
 * de appointments por doctorId+status + cobros del periodo), independiente
 * del N, y una cuarta solo si alguien cobró sin estar en la lista.
 */
async function buildTeamPerformance(
  period: AdminPeriod,
  clinicId: string,
  timezone: string,
  category: string,
): Promise<HomeAdminTeamRow[]> {
  const { from, to } = periodRangeUtc(period, timezone);

  const [activos, grouped, cobrado] = await Promise.all([
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
    ingresosPorDoctorDelPeriodo(clinicId, { gte: from, lt: to }).catch((err) => {
      console.error("[home admin] team revenue query failed:", err);
      return new Map<string | null, { total: number; orto: number }>();
    }),
  ]);

  const fuera = idsConIngresoFueraDeLista(activos.map((d) => d.id), cobrado);
  const doctors = fuera.length > 0
    ? [
        ...activos,
        ...(await prisma.user.findMany({
          where: { clinicId, id: { in: fuera } }, // solo usuarios de ESTA clínica
          select: { id: true, firstName: true, lastName: true },
        })),
      ]
    : activos;

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
      doctorName: shortName(d, category),
      appointments: t.appts,
      completionPct: t.appts > 0 ? Math.round((t.completed / t.appts) * 100) : 0,
      revenueMXN: cobrado.get(d.id)?.total ?? 0,
    };
  });

  const sinDoctor = ingresoSinDoctor(cobrado);
  if (sinDoctor) {
    rows.push({
      userId: ID_SIN_DOCTOR,
      doctorName: NOMBRE_SIN_DOCTOR,
      appointments: 0,
      completionPct: 0,
      revenueMXN: sinDoctor.total,
      sinDoctor: true,
    });
  }

  return rows.sort((a, b) => b.appointments - a.appointments || b.revenueMXN - a.revenueMXN);
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

// Sin «Dr.»: el usuario no tiene campo de tratamiento ni de género, y con el
// prefijo fijo salía «Dr. Renata». Nombre y apellido, como la Agenda. Las
// categorías no médicas siguen con el nombre de pila, como estaban.
function shortName(d: { firstName: string; lastName: string }, category: string): string {
  const first = d.firstName.split(/\s+/)[0] ?? d.firstName;
  return NON_MEDICAL.includes(category) ? first : nombreDeProfesional(d) || first;
}
