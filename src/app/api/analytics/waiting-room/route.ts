import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { patientVisibilityFilter } from "@/lib/patient-visibility";
import { cachedByKey, claveDeClinica } from "@/lib/route-cache";
import { getTzParts } from "@/lib/agenda/time-utils";
import { diaDeLaClinica } from "@/lib/agenda/citas-del-periodo";
import { zonaDeClinica } from "@/lib/inventory/zona-clinica.server";
import { esperandoAhoraWhere } from "@/lib/analytics/sala-de-espera";

export const dynamic = "force-dynamic";

// WaitingRoomAlert (la pastilla del topbar) pollea esto sin parámetros cada
// 60s en todas las pantallas de recepción/admin (ver
// ~/gerentes/salidas/MAPA-conexiones.md §6.1), mismo patrón que sidebar-counts
// e insights. 30s = la mitad del intervalo de polling.
const CACHE_TTL_MS = 30_000;

/**
 * GET /api/analytics/waiting-room?from=&to=&threshold=20
 * GET /api/analytics/waiting-room?solo=alerta  → { threshold, longWaitsCount }
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
 *
 * ws1-t2 (auditoría de uso C-27): «esperando ahora» (la lista y la pastilla
 * del topbar) es solo quien llegó HOY —día de la clínica— y sigue sin pasar
 * al sillón ni a consulta, con la cita abierta (`esperandoAhoraWhere`). Antes
 * no tenía límite de fecha y salían alertas de «1956m» por citas de días
 * anteriores que se quedaron en «Llegó». La hora y el día del mapa de calor
 * van en la zona de la clínica, no en la del servidor.
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

  // ── La pastilla del topbar (WaitingRoomAlert) solo necesita CUÁNTOS ──────
  // Pedía el reporte entero: la clínica, TODOS los timelines de 30 días para
  // el mapa de calor y la lista con nombres… y de todo eso usaba
  // `longWaits.length`. Medido el 23-sep-2026 contra producción: 2,5 s en frío.
  // Con `?solo=alerta` es un conteo con el MISMO filtro que longWaits (clínica
  // + visibilidad por paciente de quien pregunta), sin nombres en la
  // respuesta. La pantalla de analítica sigue pidiendo el reporte completo.
  //
  // CUÁNTO PUEDE ENVEJECER: 30 s, contra un umbral de 20 min de espera.
  if (url.searchParams.get("solo") === "alerta") {
    const visAlerta = patientVisibilityFilter({ userId: user.id, role: user.role, clinicId });
    const longWaitsCount = await cachedByKey(
      // userId Y rol: el conteo depende de la visibilidad por paciente.
      claveDeClinica("waiting-room-alerta", clinicId, user.id, user.role, threshold),
      CACHE_TTL_MS,
      async () => {
        const ahora = new Date();
        const hoy = diaDeLaClinica(await zonaDeClinica(clinicId), ahora);
        return prisma.appointmentTimeline.count({
          where: esperandoAhoraWhere(clinicId, ahora, hoy.desde, threshold, visAlerta ? { patient: visAlerta } : {}),
        });
      },
    );
    return NextResponse.json({ threshold, longWaitsCount });
  }

  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { agendaDayStart: true, agendaDayEnd: true, timezone: true },
  });
  if (!clinic) return NextResponse.json({ error: "clinic_not_found" }, { status: 404 });
  const zona = clinic.timezone || "America/Mexico_City";

  const dayStart = clinic.agendaDayStart;
  const dayEnd = clinic.agendaDayEnd;
  const hours: number[] = [];
  for (let h = dayStart; h < dayEnd; h++) hours.push(h);

  // Histórico — appointment_timelines join appointment con clinicId. Solo
  // depende de clinicId + rango de fechas (nada de userId: la agregación por
  // hora no expone pacientes), así que el TTL puede compartirse entre todos
  // los usuarios de la clínica. La clave usa los parámetros CRUDOS (antes del
  // default a `new Date()`): WaitingRoomAlert pollea sin parámetros, y si la
  // clave llevara el `to` ya resuelto nunca repetiría (cambia cada milisegundo)
  // y el TTL nunca acertaría.
  const timelines = await cachedByKey(
    claveDeClinica("waiting-room-timelines", clinicId, fromParam ?? "-", toParam ?? "-"),
    CACHE_TTL_MS,
    () =>
      prisma.appointmentTimeline.findMany({
        where: {
          appointment: { clinicId, startsAt: { gte: from, lte: to } },
          totalWaitMin: { not: null },
        },
        select: {
          totalWaitMin: true,
          arrivedAt: true,
          appointment: { select: { startsAt: true } },
        },
      }),
  );

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

    // Hora y día de la semana en la zona de la CLÍNICA (no la del servidor).
    const p = getTzParts(new Date(t.appointment.startsAt), zona);
    const hour = p.hour === 24 ? 0 : p.hour;
    const dow = (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
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
  const inicioDeHoy = diaDeLaClinica(zona, now).desde;

  // Visibilidad por paciente: este listado expone nombres de pacientes que
  // esperan AHORA. Va anidado bajo `appointment` (el timeline no relaciona con
  // patient directo). null = admin, no filtra.
  const vis = patientVisibilityFilter({ userId: user.id, role: user.role, clinicId });

  // 🔴 `vis` depende de user.id (visibilidad por paciente): un doctor sin
  // acceso a un paciente no debe ver su nombre en la alerta de sala de espera.
  // La clave lleva clinicId Y userId — cachear solo por clínica haría que un
  // doctor viera la lista (con nombres) que ve otro doctor de la misma
  // clínica. No depende de from/to (longWaits usa `now`, no el rango del
  // reporte histórico), así que esos parámetros no entran en la clave.
  const longWaits = await cachedByKey(
    claveDeClinica("waiting-room-longwaits", clinicId, user.id, user.role, threshold),
    CACHE_TTL_MS,
    () =>
      prisma.appointmentTimeline.findMany({
        where: esperandoAhoraWhere(clinicId, now, inicioDeHoy, threshold, vis ? { patient: vis } : {}),
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
      }),
  );

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
