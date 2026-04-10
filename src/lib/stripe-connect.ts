import getStripe from "./stripe";

export async function createConnectAccount(doctorEmail: string, doctorName: string): Promise<string> {
  const stripe = getStripe();
  const account = await stripe.accounts.create({
    type: "express",
    country: "MX",
    email: doctorEmail,
    business_type: "individual",
    capabilities: { transfers: { requested: true } },
  });
  return account.id;
}

export async function createOnboardingLink(accountId: string, clinicId: string): Promise<string> {
  const stripe = getStripe();
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=integraciones&stripe=refresh`,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=integraciones&stripe=success`,
    type: "account_onboarding",
  });
  return link.url;
}

export async function createCheckoutSession(params: {
  appointmentId: string;
  amount: number;
  doctorStripeAccountId: string;
  commissionPct: number;
  patientEmail?: string;
  clinicName: string;
  doctorName: string;
  appointmentDate: string;
  appointmentTime: string;
}): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripe();
  const applicationFee = Math.round(params.amount * 100 * (params.commissionPct / 100));
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [{
      price_data: {
        currency: "mxn",
        unit_amount: Math.round(params.amount * 100),
        product_data: {
          name: `Teleconsulta — ${params.doctorName}`,
          description: `${params.appointmentDate} a las ${params.appointmentTime} · ${params.clinicName}`,
        },
      },
      quantity: 1,
    }],
    payment_intent_data: {
      application_fee_amount: applicationFee,
      transfer_data: { destination: params.doctorStripeAccountId },
    },
    customer_email: params.patientEmail || undefined,
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/pago/exitoso?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pago/cancelado`,
    metadata: { appointmentId: params.appointmentId },
  });
  return { sessionId: session.id, url: session.url! };
}

export async function createRefund(paymentIntentId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.refunds.create({ payment_intent: paymentIntentId });
}
