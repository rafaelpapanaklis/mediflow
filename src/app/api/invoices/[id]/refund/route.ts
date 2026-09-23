import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { round2 } from "@/lib/invoice-totals";
import { denyIfCfdiVigente } from "@/lib/invoices/cfdi-vigente";
import { cerrarLinksDeFactura } from "@/lib/factura-mp/servicio.server";

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
  // El monto se redondea a centavos en la puerta, igual que el resto de los
  // escritores de dinero: lo que entra sin redondear sale en `paid` como
  // 666.6700000000001 y arrastra el saldo a un fantasma imposible de cerrar.
  const amountRaw = round2(Number(body?.amount));
  const reason = (body?.reason ?? "").toString().trim();

  if (!isFinite(amountRaw) || amountRaw <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }

  const invoicePeek = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId },
    select: { patientId: true },
  });
  if (!invoicePeek) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });

  // Visibilidad por paciente (barrido Ola 3): reembolsar la factura de un
  // paciente restringido exige poder verlo (la lista de facturas ya filtra).
  // Pre-check FUERA de la tx: dentro solo va el flujo con lock FOR UPDATE.
  if (invoicePeek.patientId) {
    const visDenied = await assertPatientVisible(invoicePeek.patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId,
    });
    if (visDenied) return visDenied;
  }

  // Lectura + escritura en la MISMA transacción con lock de fila (FOR UPDATE),
  // igual que el cobro y mark-paid. Leída fuera, dos reembolsos simultáneos por
  // el total pasaban los dos la comprobación de lo pagado, y un reembolso que
  // leyó `paid` antes de que entrara un cobro lo pisaba al escribir. Con el
  // lock, lo que se resta es lo pagado de la fila en este momento.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${params.id} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({ where: { id: params.id, clinicId } });
    if (!invoice) return { error: "Factura no encontrada", status: 404 };
    if (invoice.status === "CANCELLED") return { error: "La factura está cancelada", status: 400 };
    // Con CFDI, reembolsar aquí lo dejaría vigente ante el SAT por el total (N3).
    // Va DENTRO del candado y sobre la fila recién leída: el apartado del
    // timbrado (UPDATE … WHERE "cfdiUuid" IS NULL) espera a que esta transacción
    // suelte la fila, así que no se cuela un timbrado entre la comprobación y el
    // reembolso.
    const cfdiDenied = denyIfCfdiVigente(invoice.cfdiUuid, "reembolsar");
    if (cfdiDenied) return { denied: cfdiDenied };
    if (invoice.paid <= 0)              return { error: "Esta factura no tiene pagos para reembolsar", status: 400 };
    // Lo pagado se compara REDONDEADO: una factura legada con paid =
    // 1000.0099999999999 rechazaba el reembolso completo de $1,000.01.
    if (amountRaw > round2(invoice.paid)) return { error: "El reembolso excede lo pagado", status: 400 };

    // El piso en 0 evita el −0 que deja ese mismo caso legado (1000.0099999999999
    // − 1000.01) y que se pintaría como "−$0.00".
    const newPaid    = round2(Math.max(0, invoice.paid - amountRaw));
    const newBalance = round2(invoice.total - newPaid);
    const newStatus  =
      newPaid <= 0 ? "PENDING" :
      newBalance > 0 ? "PARTIAL" : "PAID";

    await tx.payment.create({
      data: {
        invoiceId: params.id,
        amount: amountRaw,
        method: "refund",
        notes: reason || undefined,
      },
    });
    await tx.invoice.updateMany({
      where: { id: params.id, clinicId },
      data:  {
        paid: newPaid,
        balance: Math.max(0, newBalance),
        status: newStatus as any,
        // Si el reembolso vacía el paid, limpiamos paidAt para reflejar
        // que ya no está liquidada.
        ...(newStatus !== "PAID" ? { paidAt: null } : {}),
      },
    });
    return { invoice, newPaid, newBalance, newStatus };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  if ("denied" in result) return result.denied;
  const { invoice, newPaid, newBalance, newStatus } = result;

  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "update",
    before: { paid: invoice.paid, balance: invoice.balance, status: invoice.status },
    after:  { paid: newPaid, balance: Math.max(0, newBalance), status: newStatus, refund: { amount: amountRaw, reason: reason || undefined } },
  });

  // Mercado Pago (ws1-t1): el saldo cambió por aquí; los links pendientes piden
  // un monto viejo y se cierran. Nunca lanza.
  await cerrarLinksDeFactura({ clinicId, invoiceId: params.id });
  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}
