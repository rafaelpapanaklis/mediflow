import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import {
  calendarDayRangeUtc,
  isValidDateISO,
  todayInTz,
} from "@/lib/agenda/time-utils";

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

function isMissingTable(err: unknown): boolean {
  // P2021/42P01 = tabla faltante; P2022/42703 = columna faltante (drift de migración)
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string };
  return e.code === "P2021" || e.code === "P2022" || e.code === "42P01" || e.code === "42703";
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

    /**
     * 🔴 EL DIA ES EL DE LA CLINICA, NO EL DEL SERVIDOR NI EL DEL NAVEGADOR.
     *
     * Antes esto era `new Date(\`${dateStr}T00:00:00\`)` (sin `Z`: lo
     * resolvia la zona del PROCESO, UTC en Vercel) o `setHours(0,0,0,0)`
     * sobre esa misma hora. Para una clinica mexicana la jornada salia
     * corrida seis horas: a partir de las 18:00, el modo En Vivo perdia
     * toda la manana y ensenaba parte del dia siguiente.
     */
    const clinic = await prisma.clinic.findUnique({
      where: { id: dbUser.clinicId },
      select: { timezone: true },
    });
    const tz = clinic?.timezone ?? "America/Mexico_City";
    const dateParam = req.nextUrl.searchParams.get("date");
    const dayISO =
      dateParam && isValidDateISO(dateParam) ? dateParam : todayInTz(tz);
    const { startUtc: dayStart, endUtc: dayEnd } = calendarDayRangeUtc(dayISO, tz);

    const allDayAppointments = await prisma.appointment.findMany({
      // Visibilidad por paciente: el canvas + sala de espera exponen nombres.
      // Excluye citas de pacientes restringidos que este usuario no puede ver.
      where: {
        clinicId: dbUser.clinicId,
        startsAt: { gte: dayStart, lt: dayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        AND: relatedPatientVisibilityAnd({ userId: dbUser.id, role: dbUser.role, clinicId: dbUser.clinicId }),
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
        patientId: true,
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
          patientId: a.patientId,
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
    if (isMissingTable(err)) {
      return NextResponse.json(
        {
          error: "schema_not_migrated",
          hint: "Aplica la migración 20260428100000_clinic_layout en Supabase.",
        },
        { status: 503 },
      );
    }
    console.error("[GET /api/clinic-layout/appointments]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
