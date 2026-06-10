// ═══════════════════════════════════════════════════════════════════════════
// Pago en línea de facturas desde el portal del paciente (WS1-T4).
//
// El dinero va a la CUENTA DE LA CLÍNICA vía Stripe Connect (mismo rail que
// la teleconsulta en src/lib/stripe-connect.ts): destination charge hacia el
// stripeAccountId de la clínica, SIN application_fee (0% comisión plataforma
// por ahora — decisión de negocio pendiente, ver ORQUESTA.md).
//
// Resolución de "la cuenta de la clínica" (no existe campo clinic-level en el
// schema y el schema está congelado): el ADMIN más antiguo de la clínica con
// Stripe Connect; si ningún ADMIN tiene, el ÚNICO usuario activo con cuenta
// Connect (sin ambigüedad). Con 2+ doctores con Connect y ningún ADMIN
// conectado NO habilitamos pago en línea (evita enviar dinero al doctor
// equivocado).
//
// Idempotencia / anti doble cobro: réplica del patrón de
// src/lib/ai-billing/recharge.ts — $transaction + SELECT ... FOR UPDATE sobre
// la factura + dedup por Payment.reference (PaymentIntent id). Si Stripe
// reenvía el evento o los DOS webhooks (/api/stripe/webhook y
// /api/webhooks/stripe) procesan la misma sesión, solo se aplica una vez.
// ═══════════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import { getStripeSafe } from "@/lib/stripe";

/** metadata.kind de las sesiones de Checkout de facturas del portal. */
export const PATIENT_INVOICE_KIND = "patient-invoice";

/** Método con el que se registra el Payment del pago en línea. */
export const ONLINE_PAYMENT_METHOD = "online";

/** Estados de factura cuyo saldo se puede pagar en línea. */
export const PAYABLE_STATUSES = ["PENDING", "PARTIAL", "OVERDUE"];

/** Monto mínimo que acepta Stripe para cargos en MXN. */
export const MIN_ONLINE_AMOUNT_MXN = 10;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ── Resolución de la cuenta Connect de la clínica ──────────────────────────

/**
 * Devuelve, para cada clínica del array, el stripeAccountId que recibe los
 * pagos de facturas, aplicando la regla ADMIN-más-antiguo → único-usuario.
 * Si Stripe no está configurado a nivel plataforma devuelve un mapa vacío.
 */
export async function getClinicConnectAccounts(
  clinicIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (clinicIds.length === 0) return result;
  if (!getStripeSafe()) return result;

  const users = await prisma.user.findMany({
    where: {
      clinicId: { in: clinicIds },
      isActive: true,
      stripeAccountId: { not: null },
    },
    select: { clinicId: true, role: true, createdAt: true, stripeAccountId: true },
    orderBy: { createdAt: "asc" },
  });

  const byClinic = new Map<string, typeof users>();
  for (const u of users) {
    const list = byClinic.get(u.clinicId);
    if (list) list.push(u);
    else byClinic.set(u.clinicId, [u]);
  }

  byClinic.forEach((list, clinicId) => {
    // orderBy createdAt asc → el primer ADMIN es el más antiguo.
    const admin = list.find((u) => u.role === "ADMIN" || u.role === "SUPER_ADMIN");
    if (admin?.stripeAccountId) {
      result.set(clinicId, admin.stripeAccountId);
    } else if (list.length === 1 && list[0].stripeAccountId) {
      result.set(clinicId, list[0].stripeAccountId);
    }
  });
  return result;
}

/** Versión de una sola clínica. null = "Paga en tu clínica". */
export async function getClinicConnectAccount(clinicId: string): Promise<string | null> {
  const map = await getClinicConnectAccounts([clinicId]);
  return map.get(clinicId) ?? null;
}

// ── Creación del Checkout ───────────────────────────────────────────────────

export async function createInvoiceCheckoutSession(params: {
  invoiceId: string;
  invoiceNumber: string;
  /** Saldo a cobrar en MXN — SIEMPRE calculado server-side (Invoice.balance). */
  amountMxn: number;
  clinicId: string;
  clinicName: string;
  destinationAccountId: string;
  patientEmail?: string;
}): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripeSafe();
  if (!stripe) throw new Error("Stripe no está configurado");

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "mxn",
          unit_amount: Math.round(params.amountMxn * 100),
          product_data: {
            name: `Pago de factura ${params.invoiceNumber}`,
            description: `${params.clinicName} · Portal del paciente DaleControl`,
          },
        },
        quantity: 1,
      },
    ],
    // Destination charge: el dinero viaja a la cuenta Connect de la clínica.
    // Sin application_fee_amount — 0% comisión de plataforma por ahora.
    payment_intent_data: {
      transfer_data: { destination: params.destinationAccountId },
    },
    customer_email: params.patientEmail || undefined,
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/paciente/pagos/exito?factura=${params.invoiceId}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/paciente/pagos/cancelado`,
    metadata: {
      kind: PATIENT_INVOICE_KIND,
      invoiceId: params.invoiceId,
      clinicId: params.clinicId,
    },
  });
  return { sessionId: session.id, url: session.url! };
}

// ── Confirmación idempotente (webhook) ──────────────────────────────────────

/**
 * Aplica un pago en línea confirmado por Stripe a la factura: crea el Payment
 * y actualiza paid/balance/status. Idempotente por `reference` (PaymentIntent
 * id): si el mismo evento llega dos veces — reintento de Stripe o ambos
 * webhooks — la segunda llamada es no-op.
 *
 * El FOR UPDATE sobre la fila de la factura serializa también contra cobros
 * manuales simultáneos del dashboard (POST /api/invoices/[id]).
 */
export async function applyInvoiceOnlinePayment(params: {
  invoiceId: string;
  /** Monto realmente cobrado por Stripe en MXN (session.amount_total / 100). */
  amountMxn: number;
  /** PaymentIntent id (pi_...) o, si faltara, session id (cs_...). */
  reference: string;
}): Promise<{ applied: boolean; reason?: string }> {
  const amount = round2(params.amountMxn);
  if (!params.invoiceId || !params.reference || amount <= 0) {
    return { applied: false, reason: "params" };
  }

  return prisma.$transaction(async (tx) => {
    // Lock de la factura: serializa webhooks duplicados y cobros manuales.
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${params.invoiceId} FOR UPDATE`;

    // Dedup: ¿este PaymentIntent ya quedó registrado?
    const dup = await tx.payment.findFirst({
      where: { invoiceId: params.invoiceId, reference: params.reference },
      select: { id: true },
    });
    if (dup) return { applied: false, reason: "duplicate" };

    const invoice = await tx.invoice.findUnique({
      where: { id: params.invoiceId },
      select: { id: true, total: true, paid: true, balance: true, status: true },
    });
    if (!invoice) {
      console.error("[online-payment] factura no encontrada:", params.invoiceId);
      return { applied: false, reason: "not-found" };
    }

    // El dinero YA se cobró en Stripe: registramos el Payment siempre, pero
    // si la factura está cancelada o ya saldada NO tocamos status/saldo y lo
    // dejamos señalado para devolución manual desde el dashboard.
    const anomaly =
      invoice.status === "CANCELLED"
        ? "factura cancelada"
        : invoice.balance <= 0
          ? "factura ya saldada"
          : null;

    if (anomaly) {
      console.error(
        `[online-payment] pago en línea sobre ${anomaly} — requiere devolución`,
        { invoiceId: invoice.id, reference: params.reference, amount },
      );
      await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amount,
          method: ONLINE_PAYMENT_METHOD,
          reference: params.reference,
          notes: `⚠️ Pago en línea recibido sobre ${anomaly} — revisar/devolver`,
        },
      });
      return { applied: true, reason: "anomaly" };
    }

    const newPaid = round2(invoice.paid + amount);
    const newBalance = round2(Math.max(0, invoice.balance - amount));
    const fullyPaid = newBalance <= 0;

    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amount,
        method: ONLINE_PAYMENT_METHOD,
        reference: params.reference,
        notes: "Pago en línea desde el portal del paciente",
      },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paid: newPaid,
        balance: newBalance,
        status: fullyPaid ? "PAID" : "PARTIAL",
        paymentMethod: ONLINE_PAYMENT_METHOD,
        ...(fullyPaid ? { paidAt: new Date() } : {}),
      },
    });
    return { applied: true };
  });
}
