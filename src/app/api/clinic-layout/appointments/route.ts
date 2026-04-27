import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";

export const dynamic = "force-dynamic";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({
      where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true },
    });
    if (u) return u;
  }
  return prisma.user.findFirst({
    where: { supabaseId: user.id, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * GET /api/clinic-layout/appointments?date=YYYY-MM-DD
 * Devuelve appointments del día con shape LiveAppointment, scopeados a la
 * clínica activa. Solo los appointments que tienen resourceId asignado y
 * que están dentro del rango del día solicitado.
 */
export async function GET(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const dateStr = req.nextUrl.searchParams.get("date");
    const today = new Date();
    let dayStart: Date;
    let dayEnd: Date;
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      dayStart = new Date(`${dateStr}T00:00:00`);
      dayEnd = new Date(`${dateStr}T23:59:59`);
    } else {
      dayStart = new Date(today);
      dayStart.setHours(0, 0, 0, 0);
      dayEnd = new Date(today);
      dayEnd.setHours(23, 59, 59, 999);
    }

    const allDayAppointments = await prisma.appointment.findMany({
      where: {
        clinicId: dbUser.clinicId,
        startsAt: { gte: dayStart, lte: dayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        resourceId: true,
        startsAt: true,
        endsAt: true,
        checkedInAt: true,
        type: true,
        status: true,
        notes: true,
        patient: { select: { firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
      },
    });

    // Citas que se renderizan en el canvas (con resourceId asignado).
    const live = allDayAppointments
      .filter((a) => a.resourceId)
      .map((a) => {
        const fullName =
          `${a.patient?.firstName ?? ""} ${a.patient?.lastName ?? ""}`.trim() || "Paciente";
        const doctor =
          `${a.doctor?.firstName ?? ""} ${a.doctor?.lastName ?? ""}`.trim() || "—";
        return {
          id: a.id,
          resourceId: a.resourceId,
          patient: fullName,
          patientFull: fullName,
          treatment: a.type || a.notes || "Consulta",
          doctor,
          start: a.startsAt.toISOString(),
          end: a.endsAt.toISOString(),
          status: a.status,
        };
      });

    // Sala de espera: pacientes CHECKED_IN que aún no han pasado al sillón
    // (típicamente sin resourceId hasta que se asigna). Ordenados por
    // momento de check-in.
    const waitingRoom = allDayAppointments
      .filter((a) => a.status === "CHECKED_IN")
      .sort((a, b) => {
        const ta = a.checkedInAt?.getTime() ?? a.startsAt.getTime();
        const tb = b.checkedInAt?.getTime() ?? b.startsAt.getTime();
        return ta - tb;
      })
      .map((a) => {
        const fullName =
          `${a.patient?.firstName ?? ""} ${a.patient?.lastName ?? ""}`.trim() || "Paciente";
        const doctor =
          `${a.doctor?.firstName ?? ""} ${a.doctor?.lastName ?? ""}`.trim() || "—";
        return {
          id: a.id,
          patient: fullName,
          patientFull: fullName,
          treatment: a.type || a.notes || "Consulta",
          doctor,
          checkedInAt: a.checkedInAt?.toISOString() ?? null,
          scheduledAt: a.startsAt.toISOString(),
        };
      });

    return NextResponse.json({ appointments: live, waitingRoom });
  } catch (err) {
    console.error("[GET /api/clinic-layout/appointments]", err);
    return NextResponse.json({ error: "internal_error", appointments: [] }, { status: 500 });
  }
}
