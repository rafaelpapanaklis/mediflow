import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { round2 } from "@/lib/invoice-totals";
import { CASH_METHOD } from "@/lib/caja";

// Contexto vía el helper CENTRAL: misma resolución cookie→clínica que la
// copia local que había aquí, pero aplicando el gate de plan vencido
// (isPlanExpired) que las copias locales se saltaban.
async function getCtx() {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return { clinicId: ctx.clinicId, userId: ctx.userId, role: ctx.role, permissionsOverride: ctx.permissionsOverride };
}

/**
 * Aviso cuando este atajo cobra EFECTIVO sin un turno de caja abierto. Gemelo
 * del de POST /api/invoices/[id] — mismo criterio y mismo texto: no se bloquea
 * el cobro (dejaría sin cobrar a una clínica que no usa Caja), se marca el
 * Payment para que el dinero sea rastreable cuando ningún corte lo recoja.
 * Aquí el pago es siempre `now`, así que no hay fecha que comparar.
 */
async function cashOutsideRegisterWarning(clinicId: string, method: unknown): Promise<string | null> {
  if (method !== CASH_METHOD) return null;
  const open = await prisma.cashRegister.findFirst({
    where:   { clinicId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select:  { id: true },
  });
  return open ? null : "Efectivo cobrado sin caja abierta — no entra en ningún corte";
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

  // Visibilidad por paciente (barrido Ola 3): cobrar la factura de un paciente
  // restringido exige poder verlo (el GET de facturas ya filtra la lista).
  // Pre-check FUERA de la tx: dentro solo va el flujo con lock FOR UPDATE.
  const invoicePeek = await prisma.invoice.findFirst({
    where: { id: params.id, clinicId },
    select: { patientId: true },
  });
  if (!invoicePeek) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (invoicePeek.patientId) {
    const visDenied = await assertPatientVisible(invoicePeek.patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId,
    });
    if (visDenied) return visDenied;
  }

  const now = new Date();
  // Fuera de la transacción: es una lectura y no tiene por qué alargar el lock.
  const cashWarning = await cashOutsideRegisterWarning(clinicId, payMethod);

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

    // El saldo a cobrar sale del invariante total − paid, NO de la columna
    // `balance`: esa arrastra el ruido de los abonos anteriores y con ella este
    // atajo creaba un Payment de $0.0000000000001 (y lo sumaba al corte).
    const amount = round2(invoice.total - invoice.paid);

    // Sin saldo y sin pagos no hay nada que saldar (factura en $0): se conserva
    // el 400 de siempre.
    if (amount <= 0 && invoice.paid <= 0) return { error: "No hay saldo pendiente", status: 400 };

    // Saldo fantasma: la factura ya está cubierta al centavo pero se quedó en
    // PARTIAL por ese ruido. Se salda SIN crear un Payment: no hay dinero nuevo
    // que registrar, y bloquearla dejaría la factura imposible de cerrar.
    if (amount <= 0) {
      await tx.invoice.updateMany({
        where: { id: params.id, clinicId },
        data:  { paid: round2(invoice.paid), balance: 0, status: "PAID", paidAt: now },
      });
      return { invoice, amount: 0 };
    }

    await tx.payment.create({
      data: {
        invoiceId: params.id, amount, method: payMethod, paidAt: now,
        ...(cashWarning ? { notes: `⚠️ ${cashWarning}` } : {}),
      },
    });
    await tx.invoice.updateMany({
      where: { id: params.id, clinicId },
      data:  { paid: round2(invoice.paid + amount), balance: 0, status: "PAID", paidAt: now, paymentMethod: payMethod },
    });
    return { invoice, amount };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  const { invoice, amount } = result;

  if (cashWarning && amount > 0) {
    console.error(`[invoices] ${cashWarning}`, { invoiceId: params.id, clinicId, amount });
  }

  await logMutation({
    req, clinicId, userId: ctx.userId,
    entityType: "invoice", entityId: params.id, action: "update",
    before: { paid: invoice.paid, balance: invoice.balance, status: invoice.status },
    after:  {
      paid: round2(invoice.paid + amount), balance: 0, status: "PAID",
      payment: { amount, method: payMethod, shortcut: "mark-paid" },
      ...(cashWarning && amount > 0 ? { cashWarning } : {}),
    },
  });

  revalidateAfter("invoices");
  revalidatePath(`/dashboard/patients/${invoice.patientId}`);
  return NextResponse.json({ success: true, ...(cashWarning && amount > 0 ? { warning: cashWarning } : {}) });
}
