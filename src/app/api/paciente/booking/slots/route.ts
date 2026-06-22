// GET /api/paciente/booking/slots?clinicId=&doctorId=&date=YYYY-MM-DD — WS2-T1.
//
// Horarios LIBRES (30 min) de un doctor para una cita NUEVA del paciente con
// sesión. Reusa el algoritmo de slots del reagendado (buildDaySlots +
// overlap en memoria) pero SIN cita previa que excluir.
//
// Multi-tenant estricto: clinicId DEBE estar en ctx.links; el doctor DEBE
// pertenecer a esa clínica y estar activo. 401 sin sesión, 404 clínica/doctor.
//
// 200: PacienteBookingSlotsResponse
//   { date, timezone, durationMin: 30, slots: ["HH:mm"] }

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { rateLimit } from "@/lib/rate-limit";
import { buildDaySlots } from "@/lib/appointment-change/slots";
import { tzLocalToUtc, todayInTz } from "@/lib/agenda/time-utils";
import type { PacienteBookingSlotsResponse } from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

const DURATION_MIN = 30;

export async function GET(req: NextRequest) {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  const rl = rateLimit(req, 30); // 30/min por IP — solo lectura de disponibilidad
  if (rl) return rl;

  const { searchParams } = new URL(req.url);
  const clinicId = searchParams.get("clinicId") ?? "";
  const doctorId = searchParams.get("doctorId") ?? "";
  const dateStr = searchParams.get("date") ?? "";

  if (!clinicId || !doctorId) {
    return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  // Multi-tenant: la clínica debe estar en los links de la sesión.
  if (!ctx.links.some((l) => l.clinicId === clinicId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Clínica (timezone + horarios).
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      timezone: true,
      schedules: {
        select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
      },
    },
  });
  if (!clinic) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // El doctor debe pertenecer a ESA clínica y estar activo.
  const doctor = await prisma.user.findFirst({
    where: {
      id: doctorId,
      clinicId,
      isActive: true,
      role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] },
    },
    select: { id: true },
  });
  if (!doctor) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const timezone = clinic.timezone;
  const todayISO = todayInTz(timezone);
  // No en el pasado, comparado en el timezone de la clínica (strings YYYY-MM-DD).
  if (dateStr < todayISO) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  // Día de la semana (independiente de timezone): 0=Lun..6=Dom.
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const scheduleDay = jsDayOfWeek === 0 ? 6 : jsDayOfWeek - 1;
  const daySchedule = clinic.schedules.find((s) => s.dayOfWeek === scheduleDay);

  if (!daySchedule || !daySchedule.enabled) {
    const body: PacienteBookingSlotsResponse = {
      date: dateStr,
      timezone,
      durationMin: DURATION_MIN,
      slots: [],
    };
    return NextResponse.json(body);
  }

  // Citas del doctor ese día en UNA query (overlap del rango del día en tz).
  const dayStartUtc = tzLocalToUtc(dateStr, 0, 0, timezone);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 86_400_000);
  const busy = await prisma.appointment.findMany({
    where: {
      clinicId,
      doctorId,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      startsAt: { lt: dayEndUtc },
      endsAt: { gt: dayStartUtc },
    },
    select: { startsAt: true, endsAt: true },
  });

  const [closeH, closeM] = daySchedule.closeTime.split(":").map(Number);
  const closeMins = closeH * 60 + closeM;
  const isToday = dateStr === todayISO;
  const nowMs = Date.now();

  const slots: string[] = [];
  for (const hhmm of buildDaySlots(daySchedule.openTime, daySchedule.closeTime, DURATION_MIN)) {
    const [h, mn] = hhmm.split(":").map(Number);
    // La duración completa debe caber antes del cierre.
    if (h * 60 + mn + DURATION_MIN > closeMins) continue;

    const slotStart = tzLocalToUtc(dateStr, h, mn, timezone);
    // Hoy (en tz de la clínica): descarta horas ya pasadas.
    if (isToday && slotStart.getTime() <= nowMs) continue;

    const slotEndMs = slotStart.getTime() + DURATION_MIN * 60_000;
    const taken = busy.some(
      (b) => b.startsAt.getTime() < slotEndMs && b.endsAt.getTime() > slotStart.getTime(),
    );
    if (!taken) slots.push(hhmm);
  }

  const body: PacienteBookingSlotsResponse = {
    date: dateStr,
    timezone,
    durationMin: DURATION_MIN,
    slots,
  };
  return NextResponse.json(body);
}
