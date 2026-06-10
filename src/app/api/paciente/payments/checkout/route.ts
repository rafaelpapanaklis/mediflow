// POST /api/paciente/payments/checkout — inicia el pago en línea de una
// factura pendiente desde el portal del paciente (WS1-T4).
//
// Body: { invoiceId: string } → 200 { url } | 400 | 401 | 404 | 409 | 429 | 503
//
// SEGURIDAD (no negociable):
//   · La factura se busca SIEMPRE filtrando por los patientId de la sesión
//     (ctx.links) — jamás se confía en ids del cliente.
//   · El monto SIEMPRE es Invoice.balance leído server-side — el cliente no
//     manda montos.
//   · Solo estados PENDING|PARTIAL|OVERDUE con saldo > 0.
//   · El destino del dinero es la cuenta Connect de la clínica
//     (getClinicConnectAccount); si no hay → 409 y la UI muestra
//     "Paga en tu clínica".
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import {
  PAYABLE_STATUSES,
  MIN_ONLINE_AMOUNT_MXN,
  getClinicConnectAccount,
  createInvoiceCheckoutSession,
} from "@/lib/patient-portal/online-payment";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Rate limit por IP: crear sesiones de Checkout es barato de abusar.
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const patientIds = ctx.links.map((l) => l.patientId);
    if (patientIds.length === 0) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const invoiceId = body?.invoiceId;
    if (typeof invoiceId !== "string" || !invoiceId) {
      return NextResponse.json({ error: "invoiceId requerido" }, { status: 400 });
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        patientId: { in: patientIds },
        status: { in: PAYABLE_STATUSES as any },
      },
      select: {
        id: true,
        invoiceNumber: true,
        balance: true,
        clinicId: true,
        clinic: { select: { name: true } },
      },
    });
    if (!invoice) {
      // 404 también cubre facturas de otros pacientes o ya pagadas/canceladas
      // — sin enumeración de estados ajenos.
      return NextResponse.json({ error: "Factura no encontrada o sin saldo pendiente" }, { status: 404 });
    }
    if (invoice.balance <= 0) {
      return NextResponse.json({ error: "Esta factura ya está pagada" }, { status: 400 });
    }
    if (invoice.balance < MIN_ONLINE_AMOUNT_MXN) {
      return NextResponse.json(
        { error: `El saldo es menor al mínimo para pago en línea ($${MIN_ONLINE_AMOUNT_MXN} MXN). Paga en tu clínica.` },
        { status: 400 },
      );
    }

    const destinationAccountId = await getClinicConnectAccount(invoice.clinicId);
    if (!destinationAccountId) {
      return NextResponse.json(
        { error: "Esta clínica aún no acepta pagos en línea. Paga directamente en tu clínica." },
        { status: 409 },
      );
    }

    const session = await createInvoiceCheckoutSession({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amountMxn: invoice.balance,
      clinicId: invoice.clinicId,
      clinicName: invoice.clinic?.name ?? "Tu clínica",
      destinationAccountId,
      patientEmail: ctx.account.email,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[paciente/payments/checkout] error:", err);
    return NextResponse.json(
      { error: "No se pudo iniciar el pago. Intenta de nuevo en unos minutos." },
      { status: 500 },
    );
  }
}
