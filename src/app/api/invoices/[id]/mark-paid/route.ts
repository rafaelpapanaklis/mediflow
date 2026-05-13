import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { revalidateAfter } from "@/lib/cache/revalidate";

async function getCtx() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  const select = { id: true, clinicId: true, role: true, permissionsOverride: true } as const;
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true }, select });
    if (u) return { clinicId: u.clinicId, userId: u.id, role: u.role, permissionsOverride: u.permissionsOverride };
  }
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" }, select });
  return dbUser ? { clinicId: dbUser.clinicId, userId: dbUser.id, role: dbUser.role, permissionsOverride: dbUser.permissionsOverride } : null;
}

// POST /api/invoices/[id]/mark-paid — body { method?: string }
// Atajo: cobra el saldo restante en una sola operación. Crea Payment y
// marca status=PAID. Default method="cash". El usuario lo usa cuando
// cobra en efectivo y no necesita capturar referencia.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Cobrar el saldo en bloque requiere billing.charge.
  const denied = denyIfMissingPermission(ctx, "billing.charge");
  if (denied) return denied;
  const { clinicId } = ctx;

  const { method } = await req.json().catch(() => ({ method: undefined }));
  const payMethod = (method ?? "cash") as string;

  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (invoice.status === "DRAFT")     return NextResponse.json({ error: "Confirma la factura antes de marcarla pagada" }, { status: 400 });
  if (invoice.status === "CANCELLED") return NextResponse.json({ error: "La factura está cancelada" }, { status: 400 });
  if (invoice.status === "PAID")      return NextResponse.json({ error: "La factura ya está pagada" }, { status: 400 });
  if (invoice.balance <= 0)           return NextResponse.json({ error: "No hay saldo pendiente" }, { status: 400 });

  const amount = invoice.balance;
  const now = new Date();

  await prisma.$transaction([
    prisma.payment.create({ data: { invoiceId: params.id, amount, method: payMethod, paidAt: now } }),
    prisma.invoice.updateMany({
      where: { id: params.id, clinicId },
      data:  { paid: invoice.paid + amount, balance: 0, status: "PAID", paidAt: now, paymentMethod: payMethod },
    }),
  ]);

  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "update",
    before: { paid: invoice.paid, balance: invoice.balance, status: invoice.status },
    after:  { paid: invoice.paid + amount, balance: 0, status: "PAID", payment: { amount, method: payMethod, shortcut: "mark-paid" } },
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}
