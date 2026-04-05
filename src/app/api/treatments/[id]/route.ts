import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

// PATCH /api/treatments/[id] — update plan or add a session
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    include: { sessions: { orderBy: { sessionNumber: "asc" } } },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  // Doctors can only update their own plans
  if (ctx.isDoctor && plan.doctorId !== ctx.userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json();

  // Action: add_session — marks the next pending session as complete
  if (body.action === "add_session") {
    const completedCount = plan.sessions.filter(s => s.completedAt !== null).length;
    const nextNumber     = completedCount + 1;

    if (nextNumber > plan.totalSessions) {
      return NextResponse.json({ error: "El plan ya tiene todas las sesiones completadas" }, { status: 400 });
    }

    await prisma.treatmentSession.create({
      data: {
        treatmentId:   params.id,
        sessionNumber: nextNumber,
        notes:         body.notes ?? null,
        completedAt:   new Date(),
      },
    });

    // Calculate next expected date
    const newNextExpected = new Date(Date.now() + plan.sessionIntervalDays * 24 * 60 * 60 * 1000);
    const isCompleted     = nextNumber >= plan.totalSessions;

    await prisma.treatmentPlan.update({
      where: { id: params.id },
      data: {
        nextExpectedDate: isCompleted ? null : newNextExpected,
        status:           isCompleted ? "COMPLETED" : "ACTIVE",
        updatedAt:        new Date(),
      },
    });

    return NextResponse.json({ success: true, sessionNumber: nextNumber, completed: isCompleted });
  }

  // Action: update status
  if (body.status) {
    const validStatuses = ["ACTIVE","COMPLETED","ABANDONED","PAUSED"];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    }
    await prisma.treatmentPlan.update({
      where: { id: params.id },
      data:  { status: body.status },
    });
    return NextResponse.json({ success: true });
  }

  // General update (name, description, totalCost, etc.)
  const updateData: any = {};
  if (body.name        !== undefined) updateData.name        = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.totalCost   !== undefined) updateData.totalCost   = Number(body.totalCost);
  if (body.totalSessions !== undefined) updateData.totalSessions = Number(body.totalSessions);
  if (body.sessionIntervalDays !== undefined) updateData.sessionIntervalDays = Number(body.sessionIntervalDays);

  await prisma.treatmentPlan.update({
    where: { id: params.id },
    data:  { ...updateData, updatedAt: new Date() },
  });
  return NextResponse.json({ success: true });
}

// DELETE /api/treatments/[id]
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  if (ctx.isDoctor && plan.doctorId !== ctx.userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  await prisma.treatmentPlan.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
