import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, buildPatientWhere } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { patientSchema } from "@/lib/validations";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Use buildPatientWhere so doctors can only see their own patients
  const patient = await prisma.patient.findFirst({
    where: { ...buildPatientWhere(ctx), id: params.id },
    include: {
      appointments: { orderBy: { date: "desc" }, include: { doctor: true } },
      records:      { orderBy: { visitDate: "desc" }, include: { doctor: true } },
      invoices:     { include: { payments: true } },
    },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  return NextResponse.json(patient);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify patient belongs to clinic first
  const exists = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!exists) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  try {
    const body = await req.json();
    const data = patientSchema.parse(body);
    await prisma.patient.update({
      where: { id: params.id },
      data: {
        ...data,
        dob:    data.dob    ? new Date(data.dob) : undefined,
        email:  data.email  || undefined,
        gender: (data.gender ?? "OTHER") as any,
      },
    });
    const updated = await prisma.patient.findUnique({ where: { id: params.id } });
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only admins can archive patients
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores pueden archivar pacientes" }, { status: 403 });

  await prisma.patient.updateMany({
    where: { id: params.id, clinicId: ctx.clinicId },
    data:  { status: "ARCHIVED" },
  });
  return NextResponse.json({ success: true });
}
