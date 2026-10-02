import { prisma } from "@/lib/prisma";
import { revenuePaymentWhere } from "@/lib/caja";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import type { TFunction } from "@/i18n/t";
import { zonaDeClinica } from "@/lib/inventory/zona-clinica.server";
import { ventanasDeReportes } from "./ventanas-de-reportes";
import { cargarFiltroSinPrueba } from "@/lib/patients/paciente-de-prueba-db";
import { SIN_FILTRO_DE_PRUEBA } from "@/lib/patients/paciente-de-prueba";

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

  // ws1-t11 (11d): los «Pacientes de prueba / no contactar» no cuentan. Sin
  // ninguno (o sin el SQL pegado) los tres son `{}` y cada consulta queda
  // exactamente como antes. Van en spread DENTRO de `{ clinicId, … }`: ninguna
  // de estas consultas filtra ya por `id` ni por `patientId`.
  const sinPrueba = await safe(cargarFiltroSinPrueba(clinicId), SIN_FILTRO_DE_PRUEBA);
  const sinPruebaPac = sinPrueba.paciente;
  const sinPruebaCita = sinPrueba.porPatientId;

  // Promise.all #1 — series mensuales (3 promesas)
  const [revenueResults, patientCounts, apptCounts] = await Promise.all([
    // Ingresos del mes SIN reembolsos ni facturas canceladas (revenuePaymentWhere,
    // el mismo criterio que el home). Antes sumaba TODO Payment: un reembolso
    // (method "refund", monto positivo) inflaba el mes en que se devolvió el
    // dinero, y los pagos de facturas anuladas inflaban toda la serie.
    Promise.all(ranges.map(r =>
      safe(
        prisma.payment.aggregate({ where: sinPrueba.pago(revenuePaymentWhere(clinicId, { gte: r.start, lt: r.end })), _sum: { amount: true } }),
        { _sum: { amount: 0 } } as any,
      )
    )),
    Promise.all(ranges.map(r =>
      safe(prisma.patient.count({ where: { clinicId, createdAt: { gte: r.start, lt: r.end }, ...sinPruebaPac } }), 0)
    )),
    Promise.all(ranges.map(r =>
      safe(prisma.appointment.count({ where: { clinicId, startsAt: { gte: r.start, lt: r.end }, ...sinPruebaCita } }), 0)
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
      by: ["type"], where: { clinicId, ...sinPruebaCita },
      _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 6,
    }), [] as any[]),
    safe(prisma.appointment.groupBy({
      by: ["status"], where: { clinicId, ...sinPruebaCita },
      _count: { id: true },
    }), [] as any[]),
    menuDosNivelesEncendido(clinicId),
  ]);

  // Promise.all #3 — KPIs actuales de pacientes y deuda (5 promesas)
  const [totalPatients, newThisMonth, newLastMonth, debtAggregate, debtCount] = await Promise.all([
    safe(prisma.patient.count({ where: { clinicId, ...sinPruebaPac } }), 0),
    safe(prisma.patient.count({ where: { clinicId, createdAt: { gte: startOfMonth }, ...sinPruebaPac } }), 0),
    safe(prisma.patient.count({ where: { clinicId, createdAt: { gte: startOfLastMonth, lt: endOfLastMonth }, ...sinPruebaPac } }), 0),
    safe(prisma.invoice.aggregate({
      where: { clinicId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] }, ...sinPruebaCita },
      _sum: { balance: true },
    }), { _sum: { balance: 0 } } as any),
    safe(prisma.invoice.findMany({
      where: { clinicId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] }, ...sinPruebaCita },
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
        ...sinPruebaCita,
      },
    }), 0),
    safe(prisma.appointment.count({
      where: {
        clinicId,
        startsAt: { gte: todayStart, lt: weekEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        ...sinPruebaCita,
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
      where: { clinicId, startsAt: { gte: thirtyDaysAgo }, resourceId: { not: null }, status: { notIn: ["CANCELLED", "NO_SHOW"] }, ...sinPruebaCita },
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

  // Prisma tipa `_sum` como `... | null`. Defensa con Number().
  const monthlyData = ranges.map((r, i) => ({
    label:        r.label,
    revenue:      Number(revenueResults[i]?._sum?.amount ?? 0),
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
