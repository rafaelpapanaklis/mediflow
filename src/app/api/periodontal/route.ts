import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { assertPatientVisible } from "@/lib/patient-visibility";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patientId = new URL(req.url).searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });
  // Visibilidad por paciente: sin este gate se leía el periodontograma de un
  // paciente restringido con solo su id.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;
  const records = await prisma.periodontalRecord.findMany({
    where: { patientId, clinicId: ctx.clinicId },
    orderBy: { recordedAt: "desc" },
    take: 10,
  });
  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { patientId, measurements, notes, bleedingIndex, plaquIndex } = await req.json();
  if (!patientId || !measurements) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  // Verify patient belongs to this clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Visibilidad por paciente: no crear registros sobre un paciente restringido.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const record = await prisma.periodontalRecord.create({
    data: { patientId, clinicId: ctx.clinicId, doctorId: ctx.userId, measurements, notes, bleedingIndex, plaquIndex },
  });

  // NOM-024 §6.3.5 — bitácora de creación del registro periodontal.
  // clinicId/userId SIEMPRE de sesión (getAuthContext), nunca del body.
  await logMutation({
    req,
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "periodontal",
    entityId:   record.id,
    action:     "create",
    after:      { patientId: record.patientId, doctorId: record.doctorId },
  });

  return NextResponse.json(record, { status: 201 });
}
