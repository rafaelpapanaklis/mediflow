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

interface Params { params: { id: string } }

/**
 * GET /api/patients/[id]/odontogram-history
 * Devuelve los snapshots del paciente ordenados desc por fecha.
 * Cada snapshot incluye: id, appointmentId, snapshotAt, entries (JSON).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const patient = await prisma.patient.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      select: { id: true },
    });
    if (!patient) {
      return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
    }
    const snapshots = await prisma.odontogramSnapshot.findMany({
      where: { patientId: params.id },
      orderBy: { snapshotAt: "desc" },
      select: {
        id: true,
        appointmentId: true,
        snapshotAt: true,
        entries: true,
        appointment: {
          select: {
            startsAt: true,
            type: true,
            doctor: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    return NextResponse.json({
      snapshots: snapshots.map((s) => ({
        id: s.id,
        appointmentId: s.appointmentId,
        snapshotAt: s.snapshotAt.toISOString(),
        entries: s.entries,
        appointmentType: s.appointment.type,
        appointmentDate: s.appointment.startsAt.toISOString(),
        doctorName: s.appointment.doctor
          ? `Dr/a. ${s.appointment.doctor.firstName} ${s.appointment.doctor.lastName}`.trim()
          : null,
      })),
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2021") {
      return NextResponse.json(
        {
          error: "schema_not_migrated",
          hint: "Tabla odontogram_snapshots no existe. Aplica la migración 20260427180000_odontogram_snapshot.",
        },
        { status: 503 },
      );
    }
    console.error("[/api/patients/:id/odontogram-history]", err);
    return NextResponse.json(
      { error: "internal_error", reason: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
