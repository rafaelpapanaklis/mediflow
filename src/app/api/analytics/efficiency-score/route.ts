import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { RECIBE_CITAS_WHERE } from "@/lib/agenda/roles-que-atienden";
import { diaDeLaClinica, mesDeLaClinica } from "@/lib/agenda/citas-del-periodo";
import { puntajeDeEficiencia } from "@/lib/agenda/eficiencia";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/efficiency-score?date=2026-04-28
 *
 * Score = (% ocupación por horario) * 0.6 + (% espacios usados) * 0.4
 *
 * ws1-t2 (auditoría de uso C-26; decisión 9 de Rafael: «ocupación por
 * horario»): el tiempo disponible sale del HORARIO de Ajustes
 * (`ClinicSchedule`, día por día) por cada profesional que recibe citas —la
 * misma cuenta que la Ocupación de Inicio y la barra de la Agenda—, y los días
 * son los de la ZONA de la clínica. Antes eran las horas fijas
 * `agendaDayStart–End` todos los días (también domingos cerrados) y el día del
 * SERVIDOR: decía «0 de 100» mientras Inicio decía «Ocupación 27 %».
 * Ver lib/agenda/eficiencia.ts.
 *
 * Devuelve { score, today, monthAverage, ocupacionHoy, ocupacionMes, … }.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;
  if (!clinicId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { timezone: true, defaultSlotMinutes: true },
  });
  if (!clinic) return NextResponse.json({ error: "clinic_not_found" }, { status: 404 });

  const zona = clinic.timezone || "America/Mexico_City";
  // `date` (YYYY-MM-DD) es un día de la clínica: se toma su mediodía para no cruzar de día por la zona.
  const ref = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? new Date(`${dateParam}T12:00:00Z`)
    : new Date();
  const hoy = diaDeLaClinica(zona, ref);
  const mes = mesDeLaClinica(zona, ref);

  const [schedules, profesionales, citas] = await Promise.all([
    prisma.clinicSchedule.findMany({
      where: { clinicId },
      select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
    }),
    prisma.user.findMany({ where: { clinicId, ...RECIBE_CITAS_WHERE }, select: { id: true } }),
    prisma.appointment.findMany({
      where: { clinicId, startsAt: { gte: mes.desde, lt: mes.hasta } },
      select: { startsAt: true, endsAt: true, status: true, doctorId: true },
    }),
  ]);

  const r = puntajeDeEficiencia({
    hoy,
    mes,
    ahora: ref,
    zona,
    schedules,
    profesionales: profesionales.map((p) => p.id),
    citas,
    minutosPorEspacio: clinic.defaultSlotMinutes ?? 15,
  });

  return NextResponse.json({
    score: r.hoy,
    today: r.hoy,
    monthAverage: r.promedioDelMes,
    ocupacionHoy: r.ocupacionHoy,
    ocupacionMes: r.ocupacionMes,
    activeDoctors: profesionales.length,
    sinHorario: r.sinHorario,
  });
}
