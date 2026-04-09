import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");

  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }

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

  const annotation = await prisma.bodyMapAnnotation.create({
    data: {
      clinicId: ctx.clinicId,
      patientId,
      mapType,
      annotations,
      recordId: recordId ?? null,
    },
  });

  return NextResponse.json(annotation, { status: 201 });
}
