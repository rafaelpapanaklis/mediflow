import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

async function getClinicId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const dbUser = await prisma.user.findUnique({ where: { supabaseId: user.id } });
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
  const newPaid = invoice.paid + amount;
  const newBalance = invoice.total - newPaid;
  const newStatus = newBalance <= 0 ? "PAID" : "PARTIAL";
  await prisma.$transaction([
    prisma.payment.create({ data: { invoiceId: params.id, amount, method, reference, notes } }),
    prisma.invoice.update({ where: { id: params.id }, data: { paid: newPaid, balance: Math.max(0, newBalance), status: newStatus as any, paidAt: newStatus === "PAID" ? new Date() : undefined, paymentMethod: method } }),
  ]);
  revalidatePath("/dashboard");
  return NextResponse.json({ success: true });
}
