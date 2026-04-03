import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return prisma.user.findUnique({ where: { supabaseId: user.id } });
}

export async function GET(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  const where: any = { clinicId: dbUser.clinicId };
  if (patientId) where.patientId = patientId;
  const records = await prisma.medicalRecord.findMany({
    where: { ...where, OR: [{ isPrivate: false }, { isPrivate: true, doctorId: dbUser.id }] },
    include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { visitDate: "desc" },
  });
  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const record = await prisma.medicalRecord.create({ data: { ...body, clinicId: dbUser.clinicId, doctorId: dbUser.id } });
  return NextResponse.json(record, { status: 201 });
}
