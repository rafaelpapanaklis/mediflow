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

  const now = new Date();

  // Lectura + escritura con lock de fila (FOR UPDATE): serializa contra el
  // webhook de pago en línea del portal del paciente (online-payment.ts) y
  // contra dobles clicks — sin lost updates de paid/balance.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${params.id} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({ where: { id: params.id, clinicId } });
    if (!invoice) return { error: "Factura no encontrada", status: 404 };
    if (invoice.status === "DRAFT")     return { error: "Confirma la factura antes de marcarla pagada", status: 400 };
    if (invoice.status === "CANCELLED") return { error: "La factura está cancelada", status: 400 };
    if (invoice.status === "PAID")      return { error: "La factura ya está pagada", status: 400 };
    if (invoice.balance <= 0)           return { error: "No hay saldo pendiente", status: 400 };

    const amount = invoice.balance;
    await tx.payment.create({ data: { invoiceId: params.id, amount, method: payMethod, paidAt: now } });
    await tx.invoice.updateMany({
      where: { id: params.id, clinicId },
      data:  { paid: invoice.paid + amount, balance: 0, status: "PAID", paidAt: now, paymentMethod: payMethod },
    });
    return { invoice, amount };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  const { invoice, amount } = result;

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
