import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { assertPatientVisible } from "@/lib/patient-visibility";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");

  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }

  // Visibilidad por paciente: sin este gate se leían las anotaciones de un
  // paciente restringido con solo su id.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const annotations = await prisma.bodyMapAnnotation.findMany({
    where: { clinicId: ctx.clinicId, patientId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(annotations);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { patientId, mapType, annotations, recordId } = body;

  if (!patientId || !mapType || !annotations) {
    return NextResponse.json({ error: "patientId, mapType, and annotations are required" }, { status: 400 });
  }

  // Validate patient belongs to clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) {
    return NextResponse.json({ error: "Patient not found in this clinic" }, { status: 404 });
  }

  // Visibilidad por paciente: no crear anotaciones sobre un paciente restringido.
  const hidden = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const annotation = await prisma.bodyMapAnnotation.create({
    data: {
      clinicId: ctx.clinicId,
      patientId,
      mapType,
      annotations,
      recordId: recordId ?? null,
    },
  });

  // NOM-024 §6.3.5 — bitácora de creación de anotación del mapa corporal.
  // clinicId/userId SIEMPRE de sesión (getAuthContext), nunca del body.
  await logMutation({
    req,
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "body-map",
    entityId:   annotation.id,
    action:     "create",
    after:      { patientId: annotation.patientId, mapType: annotation.mapType, recordId: annotation.recordId },
  });

  return NextResponse.json(annotation, { status: 201 });
}
