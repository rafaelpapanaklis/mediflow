import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return prisma.user.findUnique({ where: { supabaseId: user.id }, include: { clinic: true } });
}

export async function GET(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
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
  const record = await prisma.medicalRecord.create({
    data: {
      clinicId:     dbUser.clinicId,
      patientId:    body.patientId,
      doctorId:     dbUser.id,
      visitDate:    new Date(),
      subjective:   body.subjective,
      objective:    body.objective,
      assessment:   body.assessment,
      plan:         body.plan,
      diagnoses:    body.diagnoses,
      vitals:       body.vitals,
      specialtyData: body.specialtyData,
    },
    include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
  });
  return NextResponse.json(record, { status: 201 });
}
