import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminAuthed } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clinicId, amount, method, reference, periodStart, periodEnd, notes, status } = await req.json();

  if (!clinicId || !amount || !periodStart || !periodEnd) {
    return NextResponse.json({ error: "Faltan campos obligatorios" }, { status: 400 });
  }

  const invoice = await prisma.subscriptionInvoice.create({
    data: {
      clinicId,
      amount:      parseFloat(amount),
      method,
      reference,
      periodStart: new Date(periodStart),
      periodEnd:   new Date(periodEnd),
      notes,
      status:      status ?? "paid",
      paidAt:      status === "paid" ? new Date() : null,
    },
    include: { clinic: { select: { name: true } } },
  });

  // If paid, update clinic subscription status
  if (status === "paid") {
    await prisma.clinic.update({
      where: { id: clinicId },
      data: {
        subscriptionStatus: "active",
        nextBillingDate:    new Date(periodEnd),
      },
    });
  }

  return NextResponse.json(invoice, { status: 201 });
}

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = new URL(req.url).searchParams.get("clinicId");
  const invoices = await prisma.subscriptionInvoice.findMany({
    where:   clinicId ? { clinicId } : {},
    include: { clinic: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take:    100,
  });

  return NextResponse.json(invoices);
}
