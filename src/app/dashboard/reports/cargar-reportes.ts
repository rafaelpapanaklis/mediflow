import { prisma } from "@/lib/prisma";
import { deudaInvoiceWhere, movimientosDelPeriodo } from "@/lib/dinero/ingresos.server";
import { netoDelPeriodo } from "@/lib/dinero/ingresos";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import type { TFunction } from "@/i18n/t";
import { zonaDeClinica } from "@/lib/inventory/zona-clinica.server";
import { ventanasDeReportes } from "./ventanas-de-reportes";
import { citasDelPeriodoWhere } from "@/lib/agenda/citas-del-periodo";

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; }
  catch (e) { console.error("[dashboard/reports] query failed:", e); return fallback; }
}

/**
 * Los datos de Reportes, tal cual los calculaba `reports/page.tsx`: el cuerpo
 * de esta función es ese bloque MOVIDO, sin tocar una consulta ni una cuenta
 * (lo fija `reportes-en-analitica/__tests__`). Vive aparte porque ahora lo leen
 * dos páginas: `/dashboard/reports` (la de siempre) y la pestaña Reportes de
 * Analítica (`/dashboard/analytics/reports`). Una sola fuente: las dos enseñan
 * siempre las mismas cifras.
 */
export async function cargarReportes(
  clinicId: string,
  t: TFunction,
  /** La zona de la clínica si quien llama ya la tiene (la sesión); si no, se lee. */
  timezone?: string | null,
  ahora: Date = new Date(),
) {
  // 12h: los cortes de mes y de día van por el calendario de la CLÍNICA, no por
  // el reloj del servidor (en Vercel, UTC): ver ventanas-de-reportes.ts.
  const zona = timezone?.trim() || (await zonaDeClinica(clinicId));
  const v = ventanasDeReportes(ahora, zona);
  const ranges = v.meses;

  // Fechas para KPIs actuales (fines exclusivos: se consultan con `lt`)
  const startOfMonth = v.inicioMes;
  const startOfLastMonth = v.inicioMesAnterior;
  const endOfLastMonth = v.finMesAnterior;
  const todayStart = v.inicioHoy;
  const todayEnd = v.finHoy;
  const weekEnd = v.finSemana;
  const thirtyDaysAgo = v.hace30Dias;

  // Promise.all #1 — series mensuales (3 promesas)
  const [movimientos, patientCounts, apptCounts] = await Promise.all([
    // Ingresos de cada mes con la definición ÚNICA (ws1-t2, lib/dinero): lo
    // cobrado NETO por fecha de cobro —cobros menos reembolsos, sin facturas
    // canceladas ni historia migrada—, lo mismo que Finanzas, Inicio y Sabina.
    // Antes restaba la fila del reembolso pero no lo devuelto: el mes salía
    // en bruto. Una sola lectura de los 6 meses y el reparto por mes en JS.
    safe(
      movimientosDelPeriodo(clinicId, { gte: ranges[0].start, lt: ranges[ranges.length - 1].end }),
      { cobros: [], reembolsos: [] },
    ),
    Promise.all(ranges.map(r =>
      safe(prisma.patient.count({ where: { clinicId, createdAt: { gte: r.start, lt: r.end } } }), 0)
    )),
    // ws1-t2 (C-11): las citas de cada mes con la definición única — el mes
    // de la clínica, SIN canceladas. Antes las contaba (104 aquí, 76 en Inicio).
    Promise.all(ranges.map(r =>
      safe(prisma.appointment.count({ where: citasDelPeriodoWhere(clinicId, r.start, r.end) }), 0)
    )),
  ]);

  // Promise.all #2 — agregados de appointments (2 promesas) + el interruptor
  // del rediseño. REDISEÑO DE REPORTES — el MISMO interruptor por clínica que
  // enciende el menú de dos niveles, Pacientes y Equipo (`clinic_feature_flags`,
  // bandera `menu-dos-niveles`), no uno propio: Rafael prueba «el diseño
  // nuevo» como una sola cosa. Falla cerrado (sin tabla, sin fila o con error
  // → false = la pantalla de hoy, tal cual). Va en este Promise.all (2 → 3
  // promesas, sigue bajo 7) para no añadir un viaje aparte a la base.
  const [topTypes, byStatus, rediseno] = await Promise.all([
    safe(prisma.appointment.groupBy({
      by: ["type"], where: { clinicId },
      _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 6,
    }), [] as any[]),
    safe(prisma.appointment.groupBy({
      by: ["status"], where: { clinicId },
      _count: { id: true },
    }), [] as any[]),
    menuDosNivelesEncendido(clinicId),
  ]);

  // Promise.all #3 — KPIs actuales de pacientes y deuda (5 promesas). La
  // deuda es la ÚNICA (ws1-t2, `deudaInvoiceWhere`): facturas emitidas con
  // saldo, ni borradores ni canceladas — la de Pacientes, CRM y Finanzas.
  const [totalPatients, newThisMonth, newLastMonth, debtAggregate, debtCount] = await Promise.all([
    safe(prisma.patient.count({ where: { clinicId } }), 0),
    safe(prisma.patient.count({ where: { clinicId, createdAt: { gte: startOfMonth } } }), 0),
    safe(prisma.patient.count({ where: { clinicId, createdAt: { gte: startOfLastMonth, lt: endOfLastMonth } } }), 0),
    safe(prisma.invoice.aggregate({
      where: deudaInvoiceWhere(clinicId),
      _sum: { balance: true },
    }), { _sum: { balance: 0 } } as any),
    safe(prisma.invoice.findMany({
      where: deudaInvoiceWhere(clinicId),
      select: { patientId: true },
      distinct: ["patientId"],
    }).then(rows => rows.length), 0),
  ]);

  // Promise.all #4 — KPIs citas, doctores, sillones (6 promesas)
  const [nextApptsToday, nextApptsWeek, activeDoctors, totalResources, resourcesByKind, topResourceUsage] = await Promise.all([
    safe(prisma.appointment.count({
      where: {
        clinicId,
        startsAt: { gte: todayStart, lt: todayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
    }), 0),
    safe(prisma.appointment.count({
      where: {
        clinicId,
        startsAt: { gte: todayStart, lt: weekEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
    }), 0),
    safe(prisma.user.count({ where: { clinicId, role: "DOCTOR", isActive: true } }), 0),
    safe(prisma.resource.count({ where: { clinicId, isActive: true } }), 0),
    safe(prisma.resource.groupBy({
      by: ["kind"],
      where: { clinicId, isActive: true },
      _count: { id: true },
    }), [] as any[]),
    safe(prisma.appointment.groupBy({
      by: ["resourceId"],
      where: { clinicId, startsAt: { gte: thirtyDaysAgo }, resourceId: { not: null }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }), [] as any[]),
  ]);

  // Enriquecer top resources con el nombre del recurso (para mostrar en UI)
  const resourceIds = topResourceUsage.map((r: any) => r.resourceId).filter(Boolean) as string[];
  const resourceMeta = resourceIds.length > 0
    ? await safe(prisma.resource.findMany({
        where: { clinicId, id: { in: resourceIds } },
        select: { id: true, name: true, kind: true },
      }), [] as any[])
    : [];
  const topResources = topResourceUsage.map((r: any) => {
    const meta = resourceMeta.find((m: any) => m.id === r.resourceId);
    return {
      resourceId: r.resourceId,
      name: meta?.name ?? t("analytics.reportsPage.unnamedResource"),
      kind: meta?.kind ?? "OTHER",
      count: r._count.id,
    };
  });

  // Calcular delta % de pacientes nuevos vs mes anterior
  const newPctDelta = newLastMonth > 0
    ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100)
    : (newThisMonth > 0 ? 100 : 0);

  // Cada movimiento a su mes (fines exclusivos, como las ventanas).
  const mesDe = (d: Date) => String(ranges.findIndex((r) => d >= r.start && d < r.end));
  const netoPorMes = netoDelPeriodo(movimientos.cobros, movimientos.reembolsos, mesDe).porClave;
  const monthlyData = ranges.map((r, i) => ({
    label:        r.label,
    revenue:      netoPorMes[String(i)] ?? 0,
    patients:     patientCounts[i] ?? 0,
    appointments: apptCounts[i] ?? 0,
  }));

  // Sanitizar groupBy antes del Flight boundary
  const serialized = JSON.parse(JSON.stringify({ topTypes, byStatus, resourcesByKind, topResources }));

  // KPIs para el cliente
  const patientStats = {
    total: totalPatients,
    newThisMonth,
    newPctDelta,
    withDebt: debtCount,
    withDebtAmount: Number(debtAggregate?._sum?.balance ?? 0),
    nextApptsToday,
    nextApptsWeek,
  };

  const clinicStats = {
    activeDoctors,
    totalResources,
    resourcesByKind: serialized.resourcesByKind,
    topResources: serialized.topResources,
  };

  return {
    monthlyData,
    topTypes: serialized.topTypes,
    byStatus: serialized.byStatus,
    patientStats,
    clinicStats,
    rediseno,
  };
}
