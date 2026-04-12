import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

async function getClinicId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const cookieStore = cookies();
  const activeClinicId = cookieStore.get("activeClinicId")?.value;
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true } });
    if (u) return u.clinicId;
  }
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" } });
  return dbUser?.clinicId ?? null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId }, include: { patient: true, payments: true } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(invoice);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { amount, method, reference, notes } = await req.json();
  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status === "DRAFT") return NextResponse.json({ error: "Confirma la factura antes de registrar pagos" }, { status: 400 });
  if (invoice.status === "CANCELLED") return NextResponse.json({ error: "Esta factura está cancelada" }, { status: 400 });
  if (amount <= 0) return NextResponse.json({ error: "El monto debe ser mayor a 0" }, { status: 400 });
  if (amount > invoice.balance) return NextResponse.json({ error: "El monto excede el saldo pendiente" }, { status: 400 });
  const newPaid = invoice.paid + amount;
  const newBalance = invoice.total - newPaid;
  const newStatus = newBalance <= 0 ? "PAID" : "PARTIAL";
  await prisma.$transaction([
    prisma.payment.create({ data: { invoiceId: params.id, amount, method, reference, notes } }),
    prisma.invoice.update({ where: { id: params.id }, data: { paid: newPaid, balance: Math.max(0, newBalance), status: newStatus as any, paidAt: newStatus === "PAID" ? new Date() : undefined, paymentMethod: method } }),
  ]);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/billing");
  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const updated = await prisma.invoice.update({ where: { id: params.id }, data: updateData });
  revalidatePath("/dashboard/billing");
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status !== "DRAFT" && invoice.paid === 0) {
    // Non-draft without payments — mark cancelled instead of delete
    await prisma.invoice.update({ where: { id: params.id }, data: { status: "CANCELLED" } });
    revalidatePath("/dashboard/billing");
    return NextResponse.json({ success: true, cancelled: true });
  }
  if (invoice.paid > 0) {
    return NextResponse.json({ error: "No se puede eliminar una factura con pagos registrados" }, { status: 400 });
  }
  // Only drafts can be hard-deleted
  await prisma.invoice.delete({ where: { id: params.id } });
  revalidatePath("/dashboard/billing");
  return NextResponse.json({ success: true });
}
