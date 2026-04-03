import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { patientSchema } from "@/lib/validations";

async function getClinicId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const dbUser = await prisma.user.findUnique({ where: { supabaseId: user.id } });
  return dbUser?.clinicId ?? null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId },
    include: { appointments: { orderBy: { date: "desc" }, include: { doctor: true } }, records: { orderBy: { visitDate: "desc" }, include: { doctor: true } }, invoices: { include: { payments: true } } },
  });
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(patient);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const data = patientSchema.parse(body);
    await prisma.patient.updateMany({
      where: { id: params.id, clinicId },
      data: { ...data, dob: data.dob ? new Date(data.dob) : undefined, email: data.email || undefined, gender: (data.gender ?? "OTHER") as any },
    });
    const updated = await prisma.patient.findUnique({ where: { id: params.id } });
    return NextResponse.json(updated);
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 400 }); }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.patient.updateMany({ where: { id: params.id, clinicId }, data: { status: "ARCHIVED" } });
  return NextResponse.json({ success: true });
}
