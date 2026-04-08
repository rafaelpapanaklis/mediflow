import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { invoiceSchema } from "@/lib/validations";

async function getClinicId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const dbUser = await prisma.user.findUnique({ where: { supabaseId: user.id } });
  return dbUser?.clinicId ?? null;
}

async function nextInvoiceNumber(clinicId: string) {
  const count = await prisma.invoice.count({ where: { clinicId } });
  return `MF-${String(count + 1).padStart(4, "0")}`;
}

export async function GET(req: NextRequest) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = 20;
  const where: any = { clinicId };
  if (search) { where.OR = [{ invoiceNumber: { contains: search, mode: "insensitive" } }, { patient: { firstName: { contains: search, mode: "insensitive" } } }]; }
  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page-1)*limit, take: limit, include: { patient: { select: { id: true, firstName: true, lastName: true } }, payments: true } }),
  ]);
  return NextResponse.json({ invoices, total, page, limit });
}

export async function POST(req: NextRequest) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const data = invoiceSchema.parse(body);
    const subtotal = data.items.reduce((s, i) => s + i.total, 0);
    const total = subtotal - (data.discount ?? 0);
    const invoice = await prisma.invoice.create({
      data: { clinicId, patientId: data.patientId, appointmentId: data.appointmentId ?? undefined,
        invoiceNumber: await nextInvoiceNumber(clinicId), items: data.items, subtotal, discount: data.discount ?? 0,
        total, paid: 0, balance: total, status: "PENDING", paymentMethod: data.paymentMethod, notes: data.notes,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined },
      include: { patient: true },
    });
    revalidatePath("/dashboard");
  return NextResponse.json(invoice, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 400 }); }
}
