import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { assertPatientVisible } from "@/lib/patient-visibility";

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

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

/**
 * GET /api/patients/[id]/odontogram-history?cursor=&limit=
 * Devuelve los snapshots del paciente ordenados desc por fecha, PAGINADOS por
 * cursor (keyset sobre snapshotAt+id, sin OFFSET). Responde { snapshots,
 * nextCursor }; nextCursor=null cuando no hay más páginas.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    // Visibilidad por paciente: 404 si el viewer no puede ver este paciente.
    const denied = await assertPatientVisible(params.id, { userId: dbUser.id, role: dbUser.role, clinicId: dbUser.clinicId });
    if (denied) return denied;
    // Aislamiento multi-tenant: el snapshot no tiene clinicId, así que el gate
    // es que el paciente pertenezca a la clínica del usuario.
    const patient = await prisma.patient.findFirst({
      where: { id: params.id, clinicId: dbUser.clinicId },
      select: { id: true },
    });
    if (!patient) {
      return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
    }

    const sp = req.nextUrl.searchParams;
    const limitParam = parseInt(sp.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const cursor = sp.get("cursor");

    const rows = await prisma.odontogramSnapshot.findMany({
      where: { patientId: params.id },
      orderBy: [{ snapshotAt: "desc" }, { id: "desc" }],
      take: limit + 1, // 1 extra para saber si hay más
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return NextResponse.json({
      snapshots: page.map((s) => ({
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
      nextCursor,
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
