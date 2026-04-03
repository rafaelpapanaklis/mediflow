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

async function nextPatientNumber(clinicId: string) {
  const last = await prisma.patient.findFirst({ where: { clinicId }, orderBy: { patientNumber: "desc" } });
  const num = last ? parseInt(last.patientNumber) + 1 : 1;
  return String(num).padStart(4, "0");
}

export async function GET(req: NextRequest) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = 20;
  const where: any = { clinicId };
  if (search) { where.OR = [
    { firstName: { contains: search, mode: "insensitive" } },
    { lastName:  { contains: search, mode: "insensitive" } },
    { email:     { contains: search, mode: "insensitive" } },
    { phone:     { contains: search } },
    { patientNumber: { contains: search } },
  ]; }
  const [total, patients] = await Promise.all([
    prisma.patient.count({ where }),
    prisma.patient.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page-1)*limit, take: limit,
      include: { appointments: { orderBy: { date: "desc" }, take: 1, select: { date: true, status: true } }, _count: { select: { appointments: true } } } }),
  ]);
  return NextResponse.json({ patients, total, page, limit });
}

export async function POST(req: NextRequest) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const data = patientSchema.parse(body);
    const patient = await prisma.patient.create({
      data: {
        clinicId, patientNumber: await nextPatientNumber(clinicId),
        firstName: data.firstName ?? "", lastName: data.lastName ?? "",
        email: data.email || undefined, phone: data.phone,
        dob: data.dob ? new Date(data.dob) : undefined,
        gender: (data.gender ?? "OTHER") as any,
        bloodType: data.bloodType, address: data.address,
        insuranceProvider: data.insuranceProvider, insurancePolicy: data.insurancePolicy,
        allergies: data.allergies ?? [], chronicConditions: data.chronicConditions ?? [],
        currentMedications: data.currentMedications ?? [], tags: data.tags ?? [],
        notes: data.notes, status: "ACTIVE",
      },
    });
    return NextResponse.json(patient, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 400 }); }
}
