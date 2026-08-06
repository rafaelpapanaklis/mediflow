import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Today start (midnight)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const queue = await prisma.walkInQueue.findMany({
    where: {
      clinicId: ctx.clinicId,
      joinedAt: { gte: todayStart },
      status: { not: "COMPLETED" },
    },
    orderBy: [{ priority: "desc" }, { joinedAt: "asc" }],
  });

  return NextResponse.json(queue);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { patientName, service, patientId } = body;

  if (!patientName?.trim() || !service?.trim()) {
    return NextResponse.json({ error: "patientName and service are required" }, { status: 400 });
  }

  // Tenant + visibilidad por paciente (barrido Ola 3): el patientId venía
  // CRUDO del body — sin ni siquiera validar la clínica se podía colgar una
  // FK a un paciente ajeno. El assert cubre las dos cosas en un query.
  if (typeof patientId === "string" && patientId) {
    const visDenied = await assertPatientVisible(patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId: ctx.clinicId,
    });
    if (visDenied) return visDenied;
  }

  const entry = await prisma.walkInQueue.create({
    data: {
      clinicId: ctx.clinicId,
      patientName: patientName.trim(),
      service: service.trim(),
      patientId: patientId ?? null,
    },
  });

  return NextResponse.json(entry, { status: 201 });
}
