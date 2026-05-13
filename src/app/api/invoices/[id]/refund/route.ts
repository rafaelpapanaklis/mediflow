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
  // Incluimos role + permissionsOverride para denyIfMissingPermission.
  const select = { id: true, clinicId: true, role: true, permissionsOverride: true } as const;
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true }, select });
    if (u) return { clinicId: u.clinicId, userId: u.id, role: u.role, permissionsOverride: u.permissionsOverride };
  }
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" }, select });
  return dbUser ? { clinicId: dbUser.clinicId, userId: dbUser.id, role: dbUser.role, permissionsOverride: dbUser.permissionsOverride } : null;
}

// POST /api/invoices/[id]/refund — body { amount: number; reason?: string }
//
// El schema actual no tiene un modelo Refund dedicado. Para evitar una
// migración en este sprint, modelamos el reembolso como una row de Payment
// con method="refund" y amount POSITIVO (el monto reembolsado) — el cliente
// entiende que un Payment con method="refund" resta del paid total.
// Invoice.paid se decrementa por el monto reembolsado y el status se
// recalcula (PAID → PARTIAL si quedó saldo, → PARTIAL → … o PENDING si paid
// llegó a 0). El audit log captura monto + razón.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Reembolsar es una operación financiera sensible — gate por permiso UI.
  const denied = denyIfMissingPermission(ctx, "billing.refund");
  if (denied) return denied;
  const { clinicId } = ctx;

  const body = await req.json().catch(() => ({}));
  const amountRaw = Number(body?.amount);
  const reason = (body?.reason ?? "").toString().trim();

  if (!isFinite(amountRaw) || amountRaw <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }

  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (invoice.status === "CANCELLED") return NextResponse.json({ error: "La factura está cancelada" }, { status: 400 });
  if (invoice.paid <= 0)              return NextResponse.json({ error: "Esta factura no tiene pagos para reembolsar" }, { status: 400 });
  if (amountRaw > invoice.paid)       return NextResponse.json({ error: "El reembolso excede lo pagado" }, { status: 400 });

  const newPaid    = invoice.paid - amountRaw;
  const newBalance = invoice.total - newPaid;
  const newStatus  =
    newPaid <= 0 ? "PENDING" :
    newBalance > 0 ? "PARTIAL" : "PAID";

  await prisma.$transaction([
    prisma.payment.create({
      data: {
        invoiceId: params.id,
        amount: amountRaw,
        method: "refund",
        notes: reason || undefined,
      },
    }),
    prisma.invoice.updateMany({
      where: { id: params.id, clinicId },
      data:  {
        paid: newPaid,
        balance: Math.max(0, newBalance),
        status: newStatus as any,
        // Si el reembolso vacía el paid, limpiamos paidAt para reflejar
        // que ya no está liquidada.
        ...(newStatus !== "PAID" ? { paidAt: null } : {}),
      },
    }),
  ]);

  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "update",
    before: { paid: invoice.paid, balance: invoice.balance, status: invoice.status },
    after:  { paid: newPaid, balance: Math.max(0, newBalance), status: newStatus, refund: { amount: amountRaw, reason: reason || undefined } },
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}
