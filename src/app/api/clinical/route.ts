import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const cookieStore = cookies();
  const activeClinicId = cookieStore.get("activeClinicId")?.value;
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true }, include: { clinic: true } });
    if (u) return u;
  }
  return prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, include: { clinic: true }, orderBy: { createdAt: "asc" } });
}

export async function GET(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patientId = req.nextUrl.searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });
  const records = await prisma.medicalRecord.findMany({
    where: { clinicId: dbUser.clinicId, patientId },
    include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { visitDate: "desc" },
  });
  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();

  // Verify patient belongs to this clinic
  const patient = await prisma.patient.findFirst({
    where: { id: body.patientId, clinicId: dbUser.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const record = await prisma.medicalRecord.create({
    data: { clinicId: dbUser.clinicId, patientId: body.patientId, doctorId: dbUser.id,
      visitDate: new Date(), subjective: body.subjective, objective: body.objective,
      assessment: body.assessment, plan: body.plan, diagnoses: body.diagnoses,
      vitals: body.vitals, specialtyData: body.specialtyData },
    include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
  });
  return NextResponse.json(record, { status: 201 });
}
