import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { revalidateAfter } from "@/lib/cache/revalidate";

// Contexto vía el helper CENTRAL: misma resolución cookie→clínica que la
// copia local que había aquí, pero aplicando el gate de plan vencido
// (isPlanExpired) que las copias locales se saltaban.
async function getCtx() {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return { clinicId: ctx.clinicId, userId: ctx.userId, role: ctx.role, permissionsOverride: ctx.permissionsOverride };
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
