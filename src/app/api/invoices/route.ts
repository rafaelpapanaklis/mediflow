import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { invoiceSchema } from "@/lib/validations";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { round2 } from "@/lib/quotes/compute";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";

async function getCtx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true } });
    if (u) return { clinicId: u.clinicId, userId: u.id, role: u.role };
  }
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" } });
  return dbUser ? { clinicId: dbUser.clinicId, userId: dbUser.id, role: dbUser.role } : null;
}

async function nextInvoiceNumber(clinicId: string) {
  const count = await prisma.invoice.count({ where: { clinicId } });
  return `MF-${String(count + 1).padStart(4, "0")}`;
}

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clinicId } = ctx;
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = 20;
  const where: any = { clinicId };
  if (search) { where.OR = [{ invoiceNumber: { contains: search, mode: "insensitive" } }, { patient: { firstName: { contains: search, mode: "insensitive" } } }]; }
  // Visibilidad por paciente. Filtro de RELACIÓN (lista de toda la clínica) y va
  // en AND porque `where.OR` de arriba (búsqueda por texto) lo volvería permisivo.
  const visibility = relatedPatientVisibilityAnd({ userId: ctx.userId, role: ctx.role, clinicId });
  if (visibility.length) where.AND = visibility;
  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page-1)*limit, take: limit, include: { patient: { select: { id: true, firstName: true, lastName: true } }, payments: true } }),
  ]);
  return NextResponse.json({ invoices, total, page, limit });
}

export async function POST(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clinicId } = ctx;
  try {
    const body = await req.json();
    const data = invoiceSchema.parse(body);

    // Campos IVA/doctor de la OLA 1 — no viven en invoiceSchema: se leen del body crudo.
    const taxIncluded = body.taxIncluded !== false; // default: el precio ya incluye IVA
    let taxRate = Number(body.taxRate);
    if (!isFinite(taxRate) || taxRate < 0) taxRate = 16;
    taxRate = Math.min(100, taxRate);

    // Doctor atribuido (opcional). Se valida que sea un DOCTOR de ESTA clínica (aislamiento).
    let doctorId: string | null = null;
    if (typeof body.doctorId === "string" && body.doctorId.trim()) {
      const doc = await prisma.user.findFirst({
        where: { id: body.doctorId.trim(), clinicId, role: "DOCTOR" },
        select: { id: true },
      });
      if (!doc) return NextResponse.json({ error: "Doctor inválido para esta clínica" }, { status: 400 });
      doctorId = doc.id;
    }

    const subtotal = round2(data.items.reduce((s, i) => s + i.total, 0));
    const base = round2(subtotal - (data.discount ?? 0));
    // IVA incluido → el total NO cambia (impuesto embebido en el precio).
    // IVA agregado → se suma sobre la base.
    const tax = taxIncluded ? 0 : round2(base * (taxRate / 100));
    const total = round2(base + tax);

    const invoice = await prisma.invoice.create({
      data: { clinicId, patientId: data.patientId, appointmentId: data.appointmentId ?? undefined,
        invoiceNumber: await nextInvoiceNumber(clinicId), items: data.items, subtotal, discount: data.discount ?? 0,
        total, paid: 0, balance: total, status: "PENDING", paymentMethod: data.paymentMethod, notes: data.notes,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        doctorId, taxRate, taxIncluded },
      include: { patient: true },
    });

    await logMutation({
      req,
      clinicId,
      userId: ctx.userId,
      entityType: "invoice",
      entityId: invoice.id,
      action: "create",
      after: { invoiceNumber: invoice.invoiceNumber, patientId: invoice.patientId, total: invoice.total },
    });

    revalidateAfter("invoices");
    revalidatePath(`/dashboard/patients/${invoice.patientId}`);
    return NextResponse.json(invoice, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 400 }); }
}
