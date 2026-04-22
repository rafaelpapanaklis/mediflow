import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

// GET /api/treatments — list all treatment plans for clinic (role-filtered)
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  const status    = searchParams.get("status"); // ACTIVE | COMPLETED | ABANDONED | PAUSED
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "200"), 1), 500);
  const skip  = Math.max(parseInt(searchParams.get("skip") ?? "0"), 0);

  const treatments = await prisma.treatmentPlan.findMany({
    where: {
      clinicId:  ctx.clinicId,
      ...(patientId ? { patientId } : {}),
      ...(ctx.isDoctor ? { doctorId: ctx.userId } : {}),
      ...(status ? { status: status as any } : {}),
    },
    include: {
      patient:  { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:   { select: { id: true, firstName: true, lastName: true, color: true } },
      sessions: { orderBy: { sessionNumber: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip,
  });

  return NextResponse.json(treatments.map(t => ({
    ...t,
    startDate:       t.startDate instanceof Date ? t.startDate.toISOString() : t.startDate,
    endDate:         t.endDate instanceof Date ? t.endDate.toISOString() : t.endDate,
    nextExpectedDate:t.nextExpectedDate instanceof Date ? t.nextExpectedDate.toISOString() : t.nextExpectedDate,
    createdAt:       t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    updatedAt:       t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
  })));
}

// POST /api/treatments — create a new treatment plan
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { patientId, doctorId, name, description, totalSessions, sessionIntervalDays, totalCost } = body;

  if (!patientId || !name) {
    return NextResponse.json({ error: "patientId y nombre son requeridos" }, { status: 400 });
  }

  // Verify patient belongs to clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Doctors can only create plans for themselves
  const assignedDoctorId = ctx.isDoctor ? ctx.userId : (doctorId ?? ctx.userId);

  const sessions = Number(totalSessions ?? 1);
  const interval = Number(sessionIntervalDays ?? 30);

  // Calculate expected end date
  const startDate = new Date();
  const endDate   = new Date(startDate.getTime() + sessions * interval * 24 * 60 * 60 * 1000);
  // First expected session = today + interval
  const nextExpectedDate = new Date(startDate.getTime() + interval * 24 * 60 * 60 * 1000);

  const plan = await prisma.treatmentPlan.create({
    data: {
      clinicId:            ctx.clinicId,
      patientId,
      doctorId:            assignedDoctorId,
      name:                name.trim(),
      description:         description?.trim() ?? null,
      totalSessions:       sessions,
      sessionIntervalDays: interval,
      totalCost:           Number(totalCost ?? 0),
      startDate,
      endDate,
      nextExpectedDate,
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true } },
      doctor:  { select: { id: true, firstName: true, lastName: true } },
      sessions:true,
    },
  });

  return NextResponse.json({
    ...plan,
    startDate:       plan.startDate.toISOString(),
    endDate:         plan.endDate?.toISOString() ?? null,
    nextExpectedDate:plan.nextExpectedDate?.toISOString() ?? null,
    createdAt:       plan.createdAt.toISOString(),
    updatedAt:       plan.updatedAt.toISOString(),
  }, { status: 201 });
}
