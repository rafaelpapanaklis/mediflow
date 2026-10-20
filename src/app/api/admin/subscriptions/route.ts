import { NextRequest, NextResponse } from "next/server";
import { sincronizarSedesIncluidas } from "@/lib/billing/sedes-incluidas";
import { prisma } from "@/lib/prisma";
import { isAdminAuthed, getAdminSession } from "@/lib/admin-auth";
import { logAdminClinicMutation } from "@/lib/admin-audit";
import { manualPeriodFields } from "@/lib/billing/proration";
import { clinicaEstabaSuspendida, esPagoManualDelPlan, finDeLoPagado, inicioDeNuevoPeriodo, mesesDeUnPeriodo } from "@/lib/billing/cobro-rechazado";
import { marcarFacturasDeLaClinica, type ResultadoMarcado } from "@/lib/billing/factura-fuera-de-stripe.server";

export async function POST(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clinicId, amount, method, reference, periodStart, periodEnd, notes, status } = await req.json();

  if (!clinicId || !amount || !periodStart || !periodEnd) {
    return NextResponse.json({ error: "Faltan campos obligatorios" }, { status: 400 });
  }

  // Doble clic en «Registrar pago» (B7): el mismo pago (clínica, monto, método y referencia) creado hace menos de 2 minutos
  // no se vuelve a registrar: el ingreso se contaría dos veces. Se devuelve la fila que ya existe.
  const idem = reference
    ? await prisma.subscriptionInvoice.findFirst({
        where: { clinicId, amount: parseFloat(amount), method, reference, createdAt: { gte: new Date(Date.now() - 120_000) } },
        include: { clinic: { select: { name: true } } },
      })
    : null;
  if (idem) return NextResponse.json({ ...idem, facturaTarjeta: null, duplicado: true }, { status: 200 });

  // PAGADO = el acceso es «pago + N meses» (X6): N sale de la duración del periodo que capturó el admin, pero se cuenta desde
  // el día y hora en que se registra el pago —sobre lo que la clínica ya tuviera pagado si estaba al corriente—, NUNCA el
  // mes de calendario que escriba el admin (si registra el mes que se debía, el acceso quedaba vencido y la tarjeta se
  // cobraba dos veces). La fila guarda el periodo REAL.
  const pagado = status === "paid";
  const ahora = new Date();
  let estabaSuspendida: boolean | undefined;
  let current: { trialEndsAt: Date | null; nextBillingDate: Date | null; subscriptionStatus: string | null } | null = null;
  let periodoReal = { inicio: new Date(periodStart), fin: new Date(periodEnd) };
  if (pagado) {
    current = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { trialEndsAt: true, nextBillingDate: true, subscriptionStatus: true },
    });
    // Estado de ANTES de activarla (octava vuelta): una clínica suspendida no debe los meses sin servicio.
    estabaSuspendida = clinicaEstabaSuspendida(current, ahora);
    const base = inicioDeNuevoPeriodo({
      ahora,
      estadoAntes: current?.subscriptionStatus,
      trialEndsAt: current?.trialEndsAt,
      nextBillingDate: current?.nextBillingDate,
    });
    periodoReal = { inicio: base, fin: finDeLoPagado(base, mesesDeUnPeriodo(periodStart, periodEnd)) };
  }

  const invoice = await prisma.subscriptionInvoice.create({
    data: {
      clinicId,
      amount:      parseFloat(amount),
      method,
      reference,
      periodStart: periodoReal.inicio,
      periodEnd:   periodoReal.fin,
      notes,
      status:      status ?? "paid",
      paidAt:      pagado ? ahora : null,
    },
    include: { clinic: { select: { name: true } } },
  });

  // If paid, update clinic subscription status. trialEndsAt (el "acceso hasta" del gate) se mueve junto con
  // nextBillingDate — nunca hacia atrás (ver manualPeriodFields).
  if (pagado) {
    await prisma.clinic.update({
      where: { id: clinicId },
      data: {
        subscriptionStatus: "active",
        ...manualPeriodFields(current, periodoReal.fin),
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
