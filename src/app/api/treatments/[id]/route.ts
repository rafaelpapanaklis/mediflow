import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await prisma.treatmentPlan.findFirst({
    where:   { id: params.id, clinicId: ctx.clinicId },
    include: { sessions: { orderBy: { sessionNumber: "asc" } } },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  if (ctx.isDoctor && plan.doctorId !== ctx.userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json();

  // ── add_session with optional inventory deduction ─────────────────────────
  if (body.action === "add_session") {
    const completedCount = plan.sessions.filter(s => s.completedAt !== null).length;
    const nextNumber     = completedCount + 1;

    if (nextNumber > plan.totalSessions) {
      return NextResponse.json({ error: "El plan ya tiene todas las sesiones completadas" }, { status: 400 });
    }

    // inventoryItems: [{ id, qty, name }]
    const invItems: { id: string; qty: number; name: string }[] = body.inventoryItems ?? [];

    if (invItems.length > 0) {
      // Fetch items and validate stock
      const dbItems = await prisma.inventoryItem.findMany({
        where: { clinicId: ctx.clinicId, id: { in: invItems.map(i => i.id) } },
      });

      for (const req of invItems) {
        const item = dbItems.find(i => i.id === req.id);
        if (!item) return NextResponse.json({ error: "Insumo no encontrado" }, { status: 404 });
        if (item.quantity < req.qty) {
          return NextResponse.json({
            error: `Stock insuficiente de "${item.name}": disponible ${item.quantity} ${item.unit}, necesitas ${req.qty}`,
          }, { status: 400 });
        }
      }

      // Deduct in transaction
      await prisma.$transaction([
        ...invItems.map(i => prisma.inventoryItem.update({
          where: { id: i.id },
          data:  { quantity: { decrement: i.qty } },
        })),
        ...invItems.map(i => prisma.inventoryHistory.create({
          data: { itemId: i.id, change: -i.qty, reason: `Sesión ${nextNumber} — ${plan.name}` },
        })),
      ]);
    }

    // Create session
    await prisma.treatmentSession.create({
      data: {
        treatmentId:   params.id,
        sessionNumber: nextNumber,
        notes:         body.notes || null,
        completedAt:   new Date(),
      },
    });

    const isCompleted     = nextNumber >= plan.totalSessions;
    const newNextExpected = new Date(Date.now() + plan.sessionIntervalDays * 24 * 60 * 60 * 1000);

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

  // ── status change ──────────────────────────────────────────────────────────
  if (body.status) {
    if (!["ACTIVE","COMPLETED","ABANDONED","PAUSED"].includes(body.status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    }
    await prisma.treatmentPlan.updateMany({ where: { id: params.id, clinicId: ctx.clinicId }, data: { status: body.status } });
    return NextResponse.json({ success: true });
  }

  // ── general update ─────────────────────────────────────────────────────────
  const data: any = { updatedAt: new Date() };
  if (body.name                !== undefined) data.name                = body.name;
  if (body.description         !== undefined) data.description         = body.description;
  if (body.totalCost           !== undefined) data.totalCost           = Number(body.totalCost);
  if (body.totalSessions       !== undefined) data.totalSessions       = Number(body.totalSessions);
  if (body.sessionIntervalDays !== undefined) data.sessionIntervalDays = Number(body.sessionIntervalDays);

  await prisma.treatmentPlan.updateMany({ where: { id: params.id, clinicId: ctx.clinicId }, data });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const plan = await prisma.treatmentPlan.findFirst({ where: { id: params.id, clinicId: ctx.clinicId } });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  if (ctx.isDoctor && plan.doctorId !== ctx.userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  await prisma.treatmentPlan.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });
  return NextResponse.json({ success: true });
}
