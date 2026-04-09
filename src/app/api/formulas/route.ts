import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  const type = searchParams.get("type");

  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }

  const records = await prisma.formulaRecord.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId,
      ...(type ? { type } : {}),
    },
    include: { patient: { select: { firstName: true, lastName: true } } },
    orderBy: { appliedAt: "desc" },
  });

  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { patientId, type, formula, notes, appliedBy } = body;

  if (!patientId || !type || !formula) {
    return NextResponse.json({ error: "patientId, type, and formula are required" }, { status: 400 });
  }

  // Validate patient belongs to clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) {
    return NextResponse.json({ error: "Patient not found in this clinic" }, { status: 404 });
  }

  const record = await prisma.formulaRecord.create({
    data: {
      clinicId: ctx.clinicId,
      patientId,
      type,
      formula,
      notes: notes ?? null,
      appliedBy: appliedBy ?? null,
    },
  });

  return NextResponse.json(record, { status: 201 });
}
