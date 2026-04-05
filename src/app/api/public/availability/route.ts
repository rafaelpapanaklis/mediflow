import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/public/availability?slug=my-clinic&date=2026-04-10&doctorId=xxx
// No authentication required — public endpoint
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug     = searchParams.get("slug");
  const dateStr  = searchParams.get("date");
  const doctorId = searchParams.get("doctorId") ?? undefined;

  if (!slug) return NextResponse.json({ error: "slug requerido" }, { status: 400 });

  const clinic = await prisma.clinic.findUnique({
    where: { slug },
    select: {
      id: true, name: true, slug: true, specialty: true,
      phone: true, address: true, city: true, logoUrl: true,
      schedules: {
        select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
      },
      users: {
        where:  { isActive: true, role: { in: ["DOCTOR","ADMIN"] } },
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

  // Validate date is not in the past
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (localDate < today) {
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

  // Get booked slots for this date
  // Use explicit UTC range that covers the full local day
  const dateStart = new Date(y, m - 1, d, 0,  0,  0, 0);
  const dateEnd   = new Date(y, m - 1, d, 23, 59, 59, 999);

  const booked = await prisma.appointment.findMany({
    where: {
      clinicId: clinic.id,
      date:     { gte: dateStart, lte: dateEnd },
      status:   { notIn: ["CANCELLED","NO_SHOW"] },
      ...(doctorId ? { doctorId } : {}),
    },
    select: { startTime: true },
  });

  const bookedTimes = new Set(booked.map(b => b.startTime));
  const available   = slots.filter(s => !bookedTimes.has(s));

  return NextResponse.json({
    clinic: {
      id: clinic.id, name: clinic.name, specialty: clinic.specialty,
      phone: clinic.phone, address: clinic.address, city: clinic.city, logoUrl: clinic.logoUrl,
    },
    doctors:     clinic.users,
    slots:       available,
    allSlots:    slots,
    bookedSlots: Array.from(bookedTimes),
  });
}
