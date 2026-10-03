import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { isUsableWhereId } from "@/lib/validations";
import { derivePaymentForm } from "@/lib/invoice-totals";
import { formaDeAnticipoDelPaciente } from "@/lib/invoices/forma-anticipo.server";

export const dynamic = "force-dynamic";

/**
 * GET /api/cfdi/forma-pago?invoiceId=… [&paymentId=…]  (ws1-t4, tanda 0)
 *
 * La forma de pago SAT que el formulario de timbrado PROPONE: la del pago de
 * mayor importe de la factura (o la de ese pago), con los «anticipo» heredando
 * la forma del dinero que formó el saldo a favor — eso solo lo sabe el
 * servidor. `{ forma: null }` = no se sabe y hay que escogerla.
 *
 * Solo lectura. Mismo permiso y misma visibilidad por paciente que abrir la
 * factura; el clinicId sale de la sesión.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;

  const invoiceId = req.nextUrl.searchParams.get("invoiceId");
  const paymentId = req.nextUrl.searchParams.get("paymentId");
  if (!isUsableWhereId(invoiceId)) {
    return NextResponse.json({ error: "Falta indicar la factura." }, { status: 400 });
  }

  const invoice = await prisma.invoice.findFirst({
    where:  { id: invoiceId, clinicId: ctx.clinicId },
    select: {
      patientId: true, paymentMethod: true,
      payments: { select: { id: true, method: true, amount: true } },
    },
  });
  if (!invoice) return NextResponse.json({ forma: null });
  if (invoice.patientId) {
    const vis = await assertPatientVisible(invoice.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (vis) return vis;
  }

  let pagos = invoice.payments;
  if (paymentId !== null) {
    if (!isUsableWhereId(paymentId)) return NextResponse.json({ forma: null });
    pagos = pagos.filter((p) => p.id === paymentId);
    if (pagos.length === 0) return NextResponse.json({ forma: null });
  }

  const formaDeAnticipo = pagos.some((p) => p.method === "anticipo")
    ? await formaDeAnticipoDelPaciente(prisma, { clinicId: ctx.clinicId, patientId: invoice.patientId })
    : null;
  const forma = derivePaymentForm(pagos, paymentId !== null ? null : invoice.paymentMethod, formaDeAnticipo);
  return NextResponse.json({ forma });
}
