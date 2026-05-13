import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";

async function getCtx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true } });
    if (u) return { clinicId: u.clinicId, userId: u.id };
  }
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" } });
  return dbUser ? { clinicId: dbUser.clinicId, userId: dbUser.id } : null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clinicId } = ctx;
  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId }, include: { patient: true, payments: true } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(invoice);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clinicId } = ctx;
  const { amount, method, reference, notes, paidAt } = await req.json();
  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status === "DRAFT") return NextResponse.json({ error: "Confirma la factura antes de registrar pagos" }, { status: 400 });
  if (invoice.status === "CANCELLED") return NextResponse.json({ error: "Esta factura está cancelada" }, { status: 400 });
  if (amount <= 0) return NextResponse.json({ error: "El monto debe ser mayor a 0" }, { status: 400 });
  if (amount > invoice.balance) return NextResponse.json({ error: "El monto excede el saldo pendiente" }, { status: 400 });
  // paidAt es opcional. Permite back-date para registrar pagos pasados; si
  // viene inválido, ignoramos y usamos default(now()).
  const paidAtDate = paidAt ? new Date(paidAt) : null;
  const validPaidAt = paidAtDate && !isNaN(paidAtDate.getTime()) ? paidAtDate : undefined;
  const newPaid = invoice.paid + amount;
  const newBalance = invoice.total - newPaid;
  const newStatus = newBalance <= 0 ? "PAID" : "PARTIAL";
  await prisma.$transaction([
    prisma.payment.create({ data: { invoiceId: params.id, amount, method, reference, notes, ...(validPaidAt ? { paidAt: validPaidAt } : {}) } }),
    prisma.invoice.updateMany({ where: { id: params.id, clinicId }, data: { paid: newPaid, balance: Math.max(0, newBalance), status: newStatus as any, paidAt: newStatus === "PAID" ? (validPaidAt ?? new Date()) : undefined, paymentMethod: method } }),
  ]);

  await logMutation({
    req,
    clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: params.id,
    action: "update",
    before: { paid: invoice.paid, balance: invoice.balance, status: invoice.status },
    after: { paid: newPaid, balance: Math.max(0, newBalance), status: newStatus, payment: { amount, method } },
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clinicId } = ctx;
  const body = await req.json();
  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Can edit items/amounts on DRAFT invoices
  if (body.items && invoice.status !== "DRAFT") {
    return NextResponse.json({ error: "Solo se pueden editar facturas en borrador" }, { status: 400 });
  }

  const updateData: any = {};
  if (body.status) updateData.status = body.status;
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.items) {
    const items = body.items;
    const subtotal = items.reduce((s: number, i: any) => s + (i.total ?? 0), 0);
    const discount = Number(body.discount ?? invoice.discount ?? 0);
    const total = subtotal - discount;
    updateData.items = items;
    updateData.subtotal = subtotal;
    updateData.discount = discount;
    updateData.total = total;
    updateData.balance = total - invoice.paid;
  }

  await prisma.invoice.updateMany({ where: { id: params.id, clinicId }, data: updateData });
  const updated = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });

  await logMutation({
    req,
    clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: params.id,
    action: "update",
    before: { status: invoice.status, total: invoice.total, notes: invoice.notes },
    after: updateData,
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clinicId } = ctx;
  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status !== "DRAFT" && invoice.paid === 0) {
    // Non-draft without payments — mark cancelled instead of delete
    await prisma.invoice.updateMany({ where: { id: params.id, clinicId }, data: { status: "CANCELLED" } });
    await logMutation({
      req, clinicId, userId: ctx.userId,
      entityType: "invoice", entityId: params.id, action: "delete",
      before: { status: invoice.status, invoiceNumber: invoice.invoiceNumber, total: invoice.total },
    });
    revalidateAfter("invoices");
    revalidatePath(`/dashboard/patients/${invoice.patientId}`);
    return NextResponse.json({ success: true, cancelled: true });
  }
  if (invoice.paid > 0) {
    return NextResponse.json({ error: "No se puede eliminar una factura con pagos registrados" }, { status: 400 });
  }
  // Only drafts can be hard-deleted
  await prisma.invoice.deleteMany({ where: { id: params.id, clinicId } });
  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "delete",
    before: { status: invoice.status, invoiceNumber: invoice.invoiceNumber },
  });
  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}
