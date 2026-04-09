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

  const photos = await prisma.beforeAfterPhoto.findMany({
    where: { clinicId: ctx.clinicId, patientId },
    include: { patient: { select: { firstName: true, lastName: true } } },
    orderBy: { takenAt: "desc" },
  });

  return NextResponse.json(photos);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { patientId, category, angle, url, sessionId, notes } = body;

  if (!patientId || !category || !angle || !url) {
    return NextResponse.json({ error: "patientId, category, angle, and url are required" }, { status: 400 });
  }

  // Verify patient belongs to clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) {
    return NextResponse.json({ error: "Patient not found in this clinic" }, { status: 404 });
  }

  const photo = await prisma.beforeAfterPhoto.create({
    data: {
      clinicId: ctx.clinicId,
      patientId,
      category,
      angle,
      url,
      sessionId: sessionId ?? null,
      notes: notes ?? null,
    },
  });

  return NextResponse.json(photo, { status: 201 });
}
