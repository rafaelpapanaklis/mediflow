import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import { tzLocalToUtc, getTzParts } from "@/lib/agenda/time-utils";
import { partitionSlotsByOverlap, slotOverlapsBusy } from "@/lib/public-booking/slots";

// GET /api/public/availability?slug=my-clinic&date=2026-04-10&doctorId=xxx
// No authentication required — public endpoint
//
// doctorId AUSENTE (o "any") = "cualquier disponible". El criterio es
// distinto al de un doctor concreto: un horario está DISPONIBLE si al menos
// UN doctor lo tiene libre, no si lo tienen libre todos. Antes se sumaban
// las citas de TODA la clínica en una sola bolsa, así que con tres doctores
// una sola cita de las 10:00 borraba las 10:00 para los otros dos y la
// agenda pública salía casi vacía.
//
// En ese modo se devuelve además `slotDoctors`: qué doctores quedan libres
// en cada horario. La UI lo usa para saber si sigue habiendo alguien y el
// POST /api/public/book vuelve a resolverlo en el servidor (el cliente no
// elige: entre que se pinta la pantalla y se confirma pueden pasar minutos).
export async function GET(req: NextRequest) {
  // Sin auth y con 2 queries a Prisma por llamada: es una puerta directa al
  // pooler de Supabase. 60/min por IP es holgadísimo para el flujo real
  // (elegir día → ver horarios) y frena el scraping de agendas.
  const rl = await persistentRateLimit(req, { limit: 60, windowSec: 60 });
  if (rl) return rl;

  const { searchParams } = new URL(req.url);
  const slug     = searchParams.get("slug");
  const dateStr  = searchParams.get("date");
  // "any" (y el parámetro ausente) = cualquier doctor disponible.
  const rawDoctorId = searchParams.get("doctorId") ?? undefined;
  const doctorId = rawDoctorId && rawDoctorId !== "any" ? rawDoctorId : undefined;

  if (!slug) return NextResponse.json({ error: "slug requerido" }, { status: 400 });

  const clinic = await prisma.clinic.findUnique({
    where: { slug },
    select: {
      id: true, name: true, slug: true, specialty: true, timezone: true,
      phone: true, address: true, city: true, logoUrl: true,
      schedules: {
        select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
      },
      users: {
        where:  { isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] } },
        select: { id: true, firstName: true, lastName: true, specialty: true, color: true },
        orderBy: { firstName: "asc" },
      },
    },
  });

  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  // No date → return clinic info + doctors only
  if (!dateStr) {
    return NextResponse.json({
      clinic: {
        id: clinic.id, name: clinic.name, specialty: clinic.specialty,
        phone: clinic.phone, address: clinic.address, city: clinic.city, logoUrl: clinic.logoUrl,
      },
      doctors:   clinic.users,
      schedules: clinic.schedules,
    });
  }

  // Validate date format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: "Formato de fecha inválido, usa YYYY-MM-DD" }, { status: 400 });
  }

  // FIX: Parse date as LOCAL (not UTC) to get correct day-of-week in Mexico
  // new Date("2026-04-05") → UTC midnight → wrong day in UTC-6
  // new Date(2026, 3, 5)   → local midnight → correct day always
  const [y, m, d] = dateStr.split("-").map(Number);
  const localDate = new Date(y, m - 1, d);

  // "Hoy" en la TZ DE LA CLÍNICA, no la del servidor (P1-10): con el reloj
  // del server en UTC, después de las 18:00 CDMX el día de hoy salía como
  // "Fecha en el pasado" y el público no podía reservar para el mismo día.
  const nowTz = getTzParts(new Date(), clinic.timezone);
  const todayInTz = `${nowTz.year}-${String(nowTz.month).padStart(2, "0")}-${String(nowTz.day).padStart(2, "0")}`;
  if (dateStr < todayInTz) {
    return NextResponse.json({ slots: [], reason: "Fecha en el pasado" });
  }

  // Map JS day (0=Sun) to our schedule (0=Mon, 6=Sun)
  const jsDayOfWeek = localDate.getDay();
  const scheduleDay = jsDayOfWeek === 0 ? 6 : jsDayOfWeek - 1;
  const daySchedule = clinic.schedules.find(s => s.dayOfWeek === scheduleDay);

  if (!daySchedule?.enabled) {
    return NextResponse.json({ slots: [], reason: "La clínica no atiende este día" });
  }

  // Build 30-min time slots
  const slots: string[] = [];
  const [openH, openM]   = daySchedule.openTime.split(":").map(Number);
  const [closeH, closeM] = daySchedule.closeTime.split(":").map(Number);
  let currentMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;

  while (currentMins + 30 <= closeMins) {
    const h = Math.floor(currentMins / 60);
    const mn = currentMins % 60;
    slots.push(`${String(h).padStart(2,"0")}:${String(mn).padStart(2,"0")}`);
    currentMins += 30;
  }

  // Citas ocupadas del día — por RANGO (startsAt/endsAt), no solo inicio,
  // para poder marcar ocupado por SOLAPE (P1-10): una cita de 10:00–11:00
  // tapa "10:00" Y "10:30". Mismo criterio que la constraint EXCLUDE y el
  // bot: CANCELLED/NO_SHOW no bloquean, y overrideReason tampoco.
  const dayStartUtc = tzLocalToUtc(dateStr, 0, 0, clinic.timezone);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 86_400_000);

  const busy = await prisma.appointment.findMany({
    where: {
      clinicId: clinic.id,
      startsAt: { lt: dayEndUtc },
      endsAt:   { gt: dayStartUtc },
      status:   { notIn: ["CANCELLED","NO_SHOW"] },
      overrideReason: null,
      ...(doctorId ? { doctorId } : {}),
    },
    // doctorId hace falta para el modo "cualquiera": hay que saber de QUIÉN es
    // cada cita ocupada, no solo que la clínica está ocupada a esa hora.
    select: { startsAt: true, endsAt: true, doctorId: true },
  });

  let available: string[];
  let bookedTimes: string[];
  /** Sólo en modo "cualquiera": qué doctores quedan libres en cada horario. */
  let slotDoctors: Record<string, string[]> | undefined;

  if (doctorId) {
    // Un doctor concreto: comportamiento de siempre, intacto.
    const partition = partitionSlotsByOverlap(slots, dateStr, clinic.timezone, 30, busy);
    available = partition.available;
    bookedTimes = partition.taken;
  } else {
    // "Cualquier disponible": el horario se cae SOLO si TODOS los doctores lo
    // tienen ocupado. Se parte la agenda por doctor y se pregunta por cada uno.
    const busyByDoctor = new Map<string, { startsAt: Date; endsAt: Date }[]>();
    for (const b of busy) {
      const list = busyByDoctor.get(b.doctorId);
      if (list) list.push(b);
      else busyByDoctor.set(b.doctorId, [b]);
    }

    available = [];
    bookedTimes = [];
    slotDoctors = {};
    for (const hhmm of slots) {
      const [h, mn] = hhmm.split(":").map(Number);
      const slotStart = tzLocalToUtc(dateStr, h, mn, clinic.timezone);
      const free = clinic.users
        .filter(u => !slotOverlapsBusy(slotStart, 30, busyByDoctor.get(u.id) ?? []))
        .map(u => u.id);
      if (free.length > 0) {
        available.push(hhmm);
        slotDoctors[hhmm] = free;
      } else {
        bookedTimes.push(hhmm);
      }
    }
  }

  // Si la fecha pedida es HOY en la zona horaria de la clínica, oculta los
  // horarios cuya hora de inicio ya pasó (antes solo se filtraban días pasados,
  // no las horas vencidas del día en curso).
  if (dateStr === todayInTz) {
    const nowMins = nowTz.hour * 60 + nowTz.minute;
    available = available.filter(s => {
      const [h, mn] = s.split(":").map(Number);
      return h * 60 + mn > nowMins;
    });
    if (slotDoctors) {
      const vivos = new Set(available);
      slotDoctors = Object.fromEntries(Object.entries(slotDoctors).filter(([s]) => vivos.has(s)));
    }
    if (available.length === 0) {
      return NextResponse.json({ slots: [], reason: "No quedan horarios disponibles para hoy" });
    }
  }

  return NextResponse.json({
    clinic: {
      id: clinic.id, name: clinic.name, specialty: clinic.specialty,
      phone: clinic.phone, address: clinic.address, city: clinic.city, logoUrl: clinic.logoUrl,
    },
    doctors:     clinic.users,
    slots:       available,
    allSlots:    slots,
    bookedSlots: bookedTimes,
    ...(slotDoctors ? { slotDoctors } : {}),
  });
}
