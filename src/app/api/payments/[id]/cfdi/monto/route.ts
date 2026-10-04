import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { isUsableWhereId } from "@/lib/validations";
import { round2 } from "@/lib/invoice-totals";
import { montoTimbrableDePago } from "@/lib/invoices/cfdi-pago-concepto";
import { sumaCfdiValidaDeFactura } from "@/lib/invoices/cfdi-pago-db";
import { textoSoloDuenoTimbra } from "@/lib/cfdi/mensajes";

export const dynamic = "force-dynamic";

// GET /api/payments/[id]/cfdi/monto — cuánto de este cobro se puede facturar AHORA (segunda
// auditoría de uso, N-21): lo neto (sin lo devuelto ni lo pasado a saldo a favor), sin pasar del
// total de la nota ni de lo que falta por timbrar. «Facturar este pago» lo enseña en vez del monto
// bruto del cobro. Solo lectura, mismo permiso que timbrar; el clinicId sale de la sesión.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return ctx ? NextResponse.json({ error: textoSoloDuenoTimbra(), code: "CFDI_SOLO_DUENO" }, { status: 403 }) : err;
  if (!isUsableWhereId(params.id)) return NextResponse.json({ error: "Falta indicar el pago." }, { status: 400 });
  const payment = await prisma.payment.findFirst({
    where: { id: params.id, invoice: { clinicId: ctx!.clinicId } },
    select: { amount: true, invoice: { select: { id: true, paid: true, total: true } } },
  });
  if (!payment) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  const yaTimbrado = await sumaCfdiValidaDeFactura(prisma, { clinicId: ctx!.clinicId, invoiceId: payment.invoice.id });
  const monto = montoTimbrableDePago({ montoDelPago: payment.amount, pagadoNeto: payment.invoice.paid, totalFactura: payment.invoice.total, yaTimbrado });
  return NextResponse.json({ monto, bruto: round2(payment.amount) });
}
