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

/** POST /api/odontogram/reset?patientId=ID — borra todas las entries del paciente. */
export async function POST(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const patientId = req.nextUrl.searchParams.get("patientId");
  if (!patientId) {
    return NextResponse.json({ error: "missing_patientId" }, { status: 400 });
  }
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: dbUser.clinicId },
    select: { id: true },
  });
  if (!patient) {
    return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
  }

  const result = await prisma.odontogramEntry.deleteMany({
    where: { patientId },
  });
  return NextResponse.json({ ok: true, deleted: result.count });
}
