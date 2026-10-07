import "server-only";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/safe-log";
import { getOwnedClinicIds } from "@/lib/branches";
import { ingresosDelPeriodo, movimientosDelPeriodo } from "@/lib/dinero/ingresos.server";
import { contarCobros } from "@/lib/dinero/abono-core";
import { calendarDayRangeUtc, getTzParts } from "@/lib/agenda/time-utils";
import { getPlanLimitsForClinic } from "@/lib/plans";
import { cargarOcupacionDelPeriodo } from "@/lib/agenda/ocupacion-del-periodo.server";
import { ESTADOS_AGENDADOS, ESTADOS_CUMPLIDOS } from "@/lib/sabina/tools/estados";
import { isPlanExpired } from "@/lib/plan-status";
import {
  dinero,
  sumarDiasISO,
  tasaPct,
  ticketPromedio,
  totalesDe,
  type FilaSedeReporte,
  type Periodo,
  type RangoISO,
  type ReporteConsolidado,
} from "./reporte-consolidado-core";

/**
 * Reporte consolidado de todas las sedes del DUEÑO (ws1-t10, auditoría
 * BEVADENT · M6). Definiciones en la cabecera de `reporte-consolidado-core.ts`.
 *
 * 🔴 Quién ve qué sede: las clínicas donde el `supabaseId` de la SESIÓN es
 * SUPER_ADMIN con ficha activa y la clínica no está archivada
 * (`getOwnedClinicIds`, el mismo criterio del alta de sedes). Ningún id de sede
 * viaja desde el cliente. Cada consulta lleva su `clinicId`; sin dueño o sin
 * sedes, lista vacía.
 *
 * Las sedes se calculan EN SERIE y cada una en tandas de ≤5 consultas: el
 * pooler se satura con más de 7 a la vez (regla de la casa). Si la consulta de
 * una sede falla se marca `fallo: true` y se sigue con las demás.
 *
 * Los días naturales son los mismos para todas; cada sede los convierte a su
 * ventana UTC con SU zona horaria (como `comparar_sedes` de Sabina).
 */
export async function reporteConsolidadoDeSedes(args: {
  supabaseId: string;
  clinicIdActiva: string;
  rango: RangoISO & { periodo: Periodo };
  ahora?: Date;
}): Promise<ReporteConsolidado> {
  const ahora = args.ahora ?? new Date();
  const vacio: ReporteConsolidado = {
    ...args.rango,
    generadoEn: ahora.toISOString(),
    sedes: [],
    totales: totalesDe([]),
  };
  if (!args.supabaseId) return vacio;

  const ids = await getOwnedClinicIds(args.supabaseId);
  if (ids.length === 0) return vacio;

  const clinicas = await prisma.clinic.findMany({
    where: { id: { in: ids }, archivedAt: null },
    select: {
      id: true, name: true, timezone: true, createdAt: true,
      plan: true, trialEndsAt: true, subscriptionStatus: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const sedes: FilaSedeReporte[] = [];
  for (const c of clinicas) {
    try {
      sedes.push(await unaSede(c, args.rango, args.clinicIdActiva, ahora));
    } catch (e) {
      logError("[reporte-sedes] sede", e);
      sedes.push(filaFallida(c.id, c.name, c.id === args.clinicIdActiva));
    }
  }
  // La activa primero; después por orden de alta.
  sedes.sort((a, b) => Number(b.esActiva) - Number(a.esActiva));

  return { ...vacio, sedes, totales: totalesDe(sedes) };
}

type ClinicaFila = {
  id: string; name: string; timezone: string;
  plan: string; trialEndsAt: Date; subscriptionStatus: string | null;
};

async function unaSede(c: ClinicaFila, rango: RangoISO, clinicIdActiva: string, ahora: Date): Promise<FilaSedeReporte> {
  const clinicId = c.id;
  const tz = c.timezone || "America/Mexico_City";
  const desde = calendarDayRangeUtc(rango.desdeISO, tz).startUtc;
  const hasta = calendarDayRangeUtc(sumarDiasISO(rango.hastaISO, 1), tz).startUtc;
  const paidAt = { gte: desde, lt: hasta };
  const startsAt = { gte: desde, lt: hasta };

  // Tanda 1 — dinero (3 consultas dentro) + citas agendadas y no-shows.
  const [ingresos, agendadas, noShows] = await Promise.all([
    ingresosDelPeriodo(clinicId, paidAt, undefined),
    prisma.appointment.count({ where: { clinicId, startsAt, status: { notIn: [...ESTADOS_AGENDADOS] } } }),
    prisma.appointment.count({ where: { clinicId, startsAt, status: "NO_SHOW" } }),
  ]);

  // Tanda 2 — atendidas, pacientes nuevos, número de cobros (con las notas del «cobro #»).
  const [atendidas, nuevos, movimientos] = await Promise.all([
    prisma.appointment.count({ where: { clinicId, startsAt, status: { in: [...ESTADOS_CUMPLIDOS] } } }),
    prisma.patient.count({ where: { clinicId, deletedAt: null, createdAt: { gte: desde, lt: hasta } } }),
    movimientosDelPeriodo(clinicId, paidAt),
  ]);
  const numeroDeCobros = contarCobros(movimientos.cobros);

  // Tanda 3 — ocupación: la MISMA cuenta de Inicio y Analítica (3 consultas dentro).
  const ocupacion = await cargarOcupacionDelPeriodo(clinicId, tz, desde, hasta);

  return {
    clinicId,
    nombre: c.name,
    esActiva: clinicId === clinicIdActiva,
    suspendida: isPlanExpired({ plan: c.plan, trialEndsAt: c.trialEndsAt, subscriptionStatus: c.subscriptionStatus } as any, ahora),
    ingresos: {
      neto: dinero(ingresos.neto),
      cobrado: dinero(ingresos.cobrado),
      reembolsos: dinero(ingresos.reembolsos),
      numeroDeCobros,
    },
    citas: { agendadas, atendidas, noShows, tasaNoShowPct: tasaPct(noShows, agendadas) },
    pacientesNuevos: nuevos,
    ocupacion: { pct: ocupacion.porcentaje, minutosOcupados: ocupacion.minutosOcupados, minutosDisponibles: ocupacion.minutosDisponibles },
    ticketPromedio: ticketPromedio(ingresos.cobrado, numeroDeCobros),
  };
}

function filaFallida(clinicId: string, nombre: string, esActiva: boolean): FilaSedeReporte {
  return {
    clinicId, nombre, esActiva, suspendida: false,
    ingresos: { neto: 0, cobrado: 0, reembolsos: 0, numeroDeCobros: 0 },
    citas: { agendadas: 0, atendidas: 0, noShows: 0, tasaNoShowPct: null },
    pacientesNuevos: 0,
    ocupacion: { pct: null, minutosOcupados: 0, minutosDisponibles: 0 },
    ticketPromedio: null,
    fallo: true,
  };
}

/**
 * Quién puede abrir el reporte: SOLO el dueño (SUPER_ADMIN) de una clínica
 * cuyo plan contempla sedes (`maxClinics ≠ 1`, es decir, el plan Clínica o un
 * override de /admin). Un ADMIN de sede no lo ve: cruza sedes. Devuelve el
 * motivo para que la página y la API contesten lo mismo.
 */
// Las dos formas declaran los dos campos: con `strict: false` TypeScript no
// estrecha la unión por `ok`, y `acceso.motivo` daría TS2339.
export type AccesoReporteSedes =
  | { ok: true; timezone: string; motivo?: undefined }
  | { ok: false; motivo: "rol" | "plan"; timezone?: undefined };

export async function accesoAlReporteDeSedes(user: { role: string; clinicId: string }): Promise<AccesoReporteSedes> {
  if (user.role !== "SUPER_ADMIN" || !user.clinicId) return { ok: false, motivo: "rol" };
  const clinic = await prisma.clinic.findFirst({
    where: { id: user.clinicId },
    select: { timezone: true, plan: true, planOverrideFor: true, maxClinicsOverride: true, maxUsersOverride: true, priceMxnMonthlyOverride: true, priceMxnAnnualOverride: true },
  });
  if (!clinic) return { ok: false, motivo: "rol" };
  const { maxClinics } = await getPlanLimitsForClinic(clinic);
  return maxClinics === null || maxClinics > 1
    ? { ok: true, timezone: clinic.timezone || "America/Mexico_City" }
    : { ok: false, motivo: "plan" };
}

/** El día de hoy (AAAA-MM-DD) en la zona de la sede activa: de ahí salen los periodos. */
export function hoyISOEn(timezone: string, ahora: Date = new Date()): string {
  const p = getTzParts(ahora, timezone || "America/Mexico_City");
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
