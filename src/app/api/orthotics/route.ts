import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible, relatedPatientVisibilityAnd } from "@/lib/patient-visibility";

// Orthotics pipeline stored as FormulaRecord with type="orthotics_pipeline"
// The formula JSON holds: { orthoticType, status, notes, startDate }

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Visibilidad por paciente. Filtro de RELACIÓN porque esto lista los
  // registros de TODA la clínica, restringidos incluidos.
  const vis = relatedPatientVisibilityAnd({
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  const records = await prisma.formulaRecord.findMany({
    where: {
      clinicId: ctx.clinicId,
      type: "orthotics_pipeline",
      ...(vis.length ? { AND: vis } : {}),
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
  const { patientId, orthoticType, notes } = body;

  if (!patientId || !orthoticType) {
    return NextResponse.json({ error: "patientId and orthoticType are required" }, { status: 400 });
  }

  // Validate patient belongs to clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) {
    return NextResponse.json({ error: "Patient not found in this clinic" }, { status: 404 });
  }

  // Visibilidad por paciente: no crear registros sobre un paciente restringido.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const record = await prisma.formulaRecord.create({
    data: {
      clinicId: ctx.clinicId,
      patientId,
      type: "orthotics_pipeline",
      formula: {
        orthoticType,
        status: "evaluation",
        notes: notes ?? null,
        startDate: new Date().toISOString(),
      },
    },
  });

  return NextResponse.json(record, { status: 201 });
}
