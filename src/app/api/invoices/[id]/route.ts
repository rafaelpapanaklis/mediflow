import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { sumInvoiceItems, computeInvoiceTotal, round2 } from "@/lib/invoice-totals";
import { findInvalidLineDiscount, LINE_DISCOUNT_ERROR } from "@/lib/validations";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { stripNestedPatientSecrets } from "@/lib/patient-secrets";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

// Contexto vía el helper CENTRAL: misma resolución cookie→clínica que la
// copia local que había aquí, pero aplicando el gate de plan vencido
// (isPlanExpired) que las copias locales se saltaban.
async function getCtx() {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return { clinicId: ctx.clinicId, userId: ctx.userId, role: ctx.role, permissionsOverride: ctx.permissionsOverride };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // LECTURA de una factura (incluye al paciente completo): exige "billing.view"
  // además del clinicId de sesión y de la visibilidad por paciente de abajo.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.view");
  if (deniedPerm) return deniedPerm;
  const { clinicId } = ctx;
  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId }, include: { patient: true, payments: true } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Visibilidad por paciente: la factura incluye el paciente COMPLETO (PII). No
  // exponerla a quien no puede ver a ese paciente (solo si está ligada a uno).
  if (invoice.patientId) {
    const denied = await assertPatientVisible(invoice.patientId, { userId: ctx.userId, role: ctx.role, clinicId });
    if (denied) return denied;
  }
  // P1-N1: `include: { patient: true }` trae la fila completa, `portalToken`
  // incluido — el bearer permanente del portal del paciente.
  return NextResponse.json(stripNestedPatientSecrets(invoice));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Registrar pagos exige "billing.charge" — el mismo permiso que ya pide
  // mark-paid: cobrar es acción financiera, no basta con poder ver la factura.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.charge");
  if (deniedPerm) return deniedPerm;
  const { clinicId } = ctx;
  // Visibilidad por paciente: no registrar pagos sobre la factura de un paciente
  // que este usuario no puede ver. Pre-check antes de la transacción para no
  // mutar-y-luego-denegar.
  const pre = await prisma.invoice.findFirst({ where: { id: params.id, clinicId }, select: { patientId: true } });
  if (pre?.patientId) {
    const denied = await assertPatientVisible(pre.patientId, { userId: ctx.userId, role: ctx.role, clinicId });
    if (denied) return denied;
  }
  const { amount: rawAmount, method, reference, notes, paidAt } = await req.json();
  const amount = Number(rawAmount);
  if (!isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El monto debe ser mayor a 0" }, { status: 400 });
  // paidAt es opcional. Permite back-date para registrar pagos pasados; si
  // viene inválido, ignoramos y usamos default(now()).
  const paidAtDate = paidAt ? new Date(paidAt) : null;
  const validPaidAt = paidAtDate && !isNaN(paidAtDate.getTime()) ? paidAtDate : undefined;
  // ...pero NUNCA a futuro: el pago se registra cuando OCURRE. Un paidAt futuro
  // encabeza el feed de actividad reciente (se lee como si ya hubiera pasado) y
  // adelanta el ingreso a un periodo que aún no cierra. El margen absorbe el
  // desfase de reloj entre el navegador y el servidor.
  if (validPaidAt && validPaidAt.getTime() > Date.now() + 60_000) {
    return NextResponse.json({ error: "La fecha de pago no puede ser futura" }, { status: 400 });
  }

  // Lectura + escritura en la MISMA transacción con lock de fila (FOR UPDATE):
  // serializa contra el webhook de pago en línea del portal del paciente
  // (online-payment.ts) y contra dobles registros simultáneos — sin lost
  // updates de paid/balance.
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${params.id} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({ where: { id: params.id, clinicId } });
    if (!invoice) return { error: "Not found", status: 404 };
    if (invoice.status === "DRAFT") return { error: "Confirma la factura antes de registrar pagos", status: 400 };
    if (invoice.status === "CANCELLED") return { error: "Esta factura está cancelada", status: 400 };
    if (amount > invoice.balance) return { error: "El monto excede el saldo pendiente", status: 400 };
    const newPaid = invoice.paid + amount;
    const newBalance = invoice.total - newPaid;
    const newStatus = newBalance <= 0 ? "PAID" : "PARTIAL";
    await tx.payment.create({ data: { invoiceId: params.id, amount, method, reference, notes, ...(validPaidAt ? { paidAt: validPaidAt } : {}) } });
    await tx.invoice.updateMany({ where: { id: params.id, clinicId }, data: { paid: newPaid, balance: Math.max(0, newBalance), status: newStatus as any, paidAt: newStatus === "PAID" ? (validPaidAt ?? new Date()) : undefined, paymentMethod: method } });
    return { invoice, newPaid, newBalance, newStatus };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  const { invoice, newPaid, newBalance, newStatus } = result;

  await logMutation({
    req,
    clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: params.id,
    action: "update",
    before: { paid: invoice.paid, balance: invoice.balance, status: invoice.status },
    after: { paid: newPaid, balance: Math.max(0, newBalance), status: newStatus, payment: { amount, method } },
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Editar la factura (status/notas/conceptos) exige "billing.edit" — el mismo
  // permiso que ya pide edit-price.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.edit");
  if (deniedPerm) return deniedPerm;
  const { clinicId } = ctx;
  const body = await req.json();
  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.patientId) {
    const denied = await assertPatientVisible(invoice.patientId, { userId: ctx.userId, role: ctx.role, clinicId });
    if (denied) return denied;
  }

  // Can edit items/amounts on DRAFT invoices
  if (body.items && invoice.status !== "DRAFT") {
    return NextResponse.json({ error: "Solo se pueden editar facturas en borrador" }, { status: 400 });
  }

  const updateData: any = {};
  if (body.status) updateData.status = body.status;
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.items) {
    // Sin esta validación, un body.items no-arreglo se guardaría tal cual en el
    // JSON (sumInvoiceItems devuelve 0 para no-arreglos) dejando la factura con
    // conceptos basura y total 0.
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "items debe ser una lista con al menos un concepto" }, { status: 400 });
    }
    const items = body.items;
    // Mismo clamp de línea que el schema del POST (findInvalidLineDiscount es la
    // ÚNICA regla, aquí no hay zod que la aplique): un descuento mayor al importe
    // deja `itemLineTotal` NEGATIVO y ese concepto en rojo encoge el subtotal, el
    // total y el balance de la factura. El editor lo acota en el cliente, pero un
    // PATCH fabricado a mano no pasa por el editor.
    const badLine = findInvalidLineDiscount(items);
    if (badLine >= 0) {
      return NextResponse.json({ error: `${LINE_DISCOUNT_ERROR} (concepto ${badLine + 1})` }, { status: 400 });
    }
    // Misma aritmética que el timbrado (qty × unitPrice − desc. de línea) para
    // que total = Σ(conceptos) − descuento se sostenga también con IVA agregado.
    const subtotal = sumInvoiceItems(items);
    // El piso en 0 espeja al POST: sin él, un descuento NEGATIVO se persistía tal
    // cual mientras computeInvoiceTotal lo trataba como 0, y la factura quedaba
    // con total ≠ Σconceptos − descuento (la guarda de integridad del timbrado
    // culpaba luego a los conceptos).
    const discount = round2(Math.max(0, Number(body.discount ?? invoice.discount ?? 0)));
    if (discount > subtotal) {
      return NextResponse.json({ error: "El descuento excede el subtotal" }, { status: 400 });
    }
    const { total } = computeInvoiceTotal(subtotal, discount, invoice.taxRate ?? 16, invoice.taxIncluded !== false);
    updateData.items = items;
    updateData.subtotal = subtotal;
    updateData.discount = discount;
    updateData.total = total;
    // Piso en 0 como en TODOS los demás escritores de balance (POST de pago,
    // edit-price, mark-paid, portal). Sin él, bajar el total de una factura ya
    // cobrada deja un saldo NEGATIVO que se resta de los "por cobrar" de la
    // clínica: $500 pagados y un PATCH a $100 dejaba balance −400.
    updateData.balance = round2(Math.max(0, total - invoice.paid));
  }

  await prisma.invoice.updateMany({ where: { id: params.id, clinicId }, data: updateData });
  const updated = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });

  await logMutation({
    req,
    clinicId,
    userId: ctx.userId,
    entityType: "invoice",
    entityId: params.id,
    action: "update",
    before: { status: invoice.status, total: invoice.total, notes: invoice.notes },
    after: updateData,
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Borrar borradores / cancelar sin pagos es edición del documento: mismo
  // "billing.edit" que el PATCH y que edit-price.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.edit");
  if (deniedPerm) return deniedPerm;
  const { clinicId } = ctx;
  const invoice = await prisma.invoice.findFirst({ where: { id: params.id, clinicId } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.patientId) {
    const denied = await assertPatientVisible(invoice.patientId, { userId: ctx.userId, role: ctx.role, clinicId });
    if (denied) return denied;
  }
  if (invoice.status !== "DRAFT" && invoice.paid === 0) {
    // Non-draft without payments — mark cancelled instead of delete
    await prisma.invoice.updateMany({ where: { id: params.id, clinicId }, data: { status: "CANCELLED" } });
    await logMutation({
      req, clinicId, userId: ctx.userId,
      entityType: "invoice", entityId: params.id, action: "delete",
      before: { status: invoice.status, invoiceNumber: invoice.invoiceNumber, total: invoice.total },
    });
    revalidateAfter("invoices");
    revalidatePath(`/dashboard/patients/${invoice.patientId}`);
    return NextResponse.json({ success: true, cancelled: true });
  }
  if (invoice.paid > 0) {
    return NextResponse.json({ error: "No se puede eliminar una factura con pagos registrados" }, { status: 400 });
  }
  // Only drafts can be hard-deleted
  await prisma.invoice.deleteMany({ where: { id: params.id, clinicId } });
  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "delete",
    before: { status: invoice.status, invoiceNumber: invoice.invoiceNumber },
  });
  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true });
}
