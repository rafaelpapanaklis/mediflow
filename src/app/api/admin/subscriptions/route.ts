import { NextRequest, NextResponse } from "next/server";
import { sincronizarSedesIncluidas } from "@/lib/billing/sedes-incluidas";
import { prisma } from "@/lib/prisma";
import { isAdminAuthed, getAdminSession } from "@/lib/admin-auth";
import { logAdminClinicMutation } from "@/lib/admin-audit";
import { manualPeriodFields } from "@/lib/billing/proration";
import { clinicaEstabaSuspendida, esPagoManualDelPlan } from "@/lib/billing/cobro-rechazado";
import { marcarFacturasDeLaClinica, type ResultadoMarcado } from "@/lib/billing/factura-fuera-de-stripe.server";

export async function POST(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clinicId, amount, method, reference, periodStart, periodEnd, notes, status } = await req.json();

  if (!clinicId || !amount || !periodStart || !periodEnd) {
    return NextResponse.json({ error: "Faltan campos obligatorios" }, { status: 400 });
  }

  const invoice = await prisma.subscriptionInvoice.create({
    data: {
      clinicId,
      amount:      parseFloat(amount),
      method,
      reference,
      periodStart: new Date(periodStart),
      periodEnd:   new Date(periodEnd),
      notes,
      status:      status ?? "paid",
      paidAt:      status === "paid" ? new Date() : null,
    },
    include: { clinic: { select: { name: true } } },
  });

  // If paid, update clinic subscription status. trialEndsAt (el "acceso
  // hasta" del gate) se mueve junto con nextBillingDate — nunca hacia atrás
  // (ver manualPeriodFields).
  // Estado de ANTES de activarla (octava vuelta): una clínica suspendida no debe los meses sin servicio.
  let estabaSuspendida: boolean | undefined;
  if (status === "paid") {
    const current = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { trialEndsAt: true, subscriptionStatus: true },
    });
    estabaSuspendida = clinicaEstabaSuspendida(current);
    await prisma.clinic.update({
      where: { id: clinicId },
      data: {
        subscriptionStatus: "active",
        ...manualPeriodFields(current, new Date(periodEnd)),
      },
    });
    await sincronizarSedesIncluidas(clinicId);
  }

  // Pago manual registrado como PAGADO (= confirmado): la factura de tarjeta del plan queda pagada fuera de Stripe.
  // Si falla, el pago y la activación siguen en pie y el admin ve el aviso.
  const facturaTarjeta: ResultadoMarcado | null = status === "paid" && esPagoManualDelPlan(method) ? await marcarFacturasDeLaClinica(clinicId, { estabaSuspendida }) : null; // «stripe» (ya se cobró allá) y cfdi_overage no

  await logAdminClinicMutation({
    req, admin: admin.user, clinicId,
    entityType: "admin-billing", entityId: clinicId, action: "create",
    after: {
      op: "create_invoice", invoiceId: invoice.id, amount: invoice.amount,
      method: method ?? null, status: invoice.status, activated: status === "paid", facturaTarjeta,
    },
  });

  return NextResponse.json({ ...invoice, facturaTarjeta }, { status: 201 });
}

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = new URL(req.url).searchParams.get("clinicId");
  const invoices = await prisma.subscriptionInvoice.findMany({
    where:   clinicId ? { clinicId } : {},
    include: { clinic: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take:    100,
  });

  return NextResponse.json(invoices);
}
