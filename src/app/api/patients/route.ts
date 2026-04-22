import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, buildPatientWhere } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  console.log("[api/patients GET] ctx.clinicId =", ctx.clinicId);

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "100"), 1), 500);
  const skip  = Math.max(parseInt(searchParams.get("skip") ?? "0"), 0);

  const patients = await prisma.patient.findMany({
    where: buildPatientWhere(ctx, {
      ...(status && { status }),
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName:  { contains: search, mode: "insensitive" } },
          { email:     { contains: search, mode: "insensitive" } },
          { phone:     { contains: search, mode: "insensitive" } },
          { patientNumber: { contains: search, mode: "insensitive" } },
        ],
      }),
    }),
    include: {
      primaryDoctor: { select: { id: true, firstName: true, lastName: true, color: true } },
      appointments: { orderBy: { date: "desc" }, take: 1, select: { date: true, status: true } },
      _count: { select: { appointments: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip,
  });

  return NextResponse.json(patients);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // Generate patient number
  const count = await prisma.patient.count({ where: { clinicId: ctx.clinicId } });
  const patientNumber = `P${String(count + 1).padStart(4, "0")}`;

  const patient = await prisma.patient.create({
    data: {
      clinicId:      ctx.clinicId,
      patientNumber,
      firstName:     body.firstName,
      lastName:      body.lastName,
      email:         body.email ?? null,
      phone:         body.phone ?? null,
      dob:           body.dob ? new Date(body.dob) : null,
      gender:        body.gender ?? "OTHER",
      bloodType:     body.bloodType ?? null,
      address:       body.address ?? null,
      notes:         body.notes ?? null,
      allergies:     body.allergies ?? [],
      chronicConditions: body.chronicConditions ?? [],
      isChild:       body.isChild ?? false,
      // Auto-assign primary doctor: if doctor creates patient, assign self
      primaryDoctorId: body.primaryDoctorId ?? (ctx.isDoctor ? ctx.userId : null),
    },
  });

  revalidatePath("/dashboard/patients");
  revalidatePath("/dashboard/clinical");
  return NextResponse.json(patient, { status: 201 });
}
