import getStripe from "./stripe";

const PLAN_PRICES: Record<string, number> = { BASIC: 299, PRO: 499, CLINIC: 799 };

export async function createCustomer(email: string, clinicName: string): Promise<string> {
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    name: clinicName,
    metadata: { source: "mediflow" },
  });
  return customer.id;
}

export async function createSubscription(params: {
  customerId: string;
  plan: string;
  clinicId: string;
}): Promise<{ subscriptionId: string; clientSecret: string | null; url: string }> {
  const stripe = getStripe();
  const amount = PLAN_PRICES[params.plan] ?? 499;

  // Create a price on the fly (or use existing product)
  const price = await stripe.prices.create({
    unit_amount: amount * 100,
    currency: "mxn",
    recurring: { interval: "month" },
    product_data: {
      name: `DaleControl ${params.plan}`,
      metadata: { plan: params.plan },
    },
  });

  const subscription = await stripe.subscriptions.create({
    customer: params.customerId,
    items: [{ price: price.id }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    metadata: { clinicId: params.clinicId, plan: params.plan },
    expand: ["latest_invoice.payment_intent"],
  });

  const invoice = subscription.latest_invoice as any;
  const clientSecret = invoice?.payment_intent?.client_secret ?? null;

  return {
    subscriptionId: subscription.id,
    clientSecret,
    url: null as any, // URL comes from checkout session, not subscription directly
  };
}

export async function createCheckoutForSubscription(params: {
  customerId: string;
  plan: string;
  clinicId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const stripe = getStripe();
  const amount = PLAN_PRICES[params.plan] ?? 499;

  const session = await stripe.checkout.sessions.create({
    customer: params.customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: "mxn",
        unit_amount: amount * 100,
        recurring: { interval: "month" },
        product_data: { name: `DaleControl Plan ${params.plan}` },
      },
      quantity: 1,
    }],
    metadata: { clinicId: params.clinicId, plan: params.plan },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  return session.url!;
}

export async function createOxxoPayment(params: {
  customerId: string;
  amount: number;
  clinicId: string;
  clinicName: string;
}): Promise<{ clientSecret: string; voucherUrl?: string }> {
  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.create({
    amount: params.amount * 100,
    currency: "mxn",
    customer: params.customerId,
    payment_method_types: ["oxxo"],
    metadata: { clinicId: params.clinicId, type: "subscription" },
    description: `DaleControl — ${params.clinicName}`,
  });

  return { clientSecret: paymentIntent.client_secret! };
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.cancel(subscriptionId);
}

export async function getCustomerPortalUrl(customerId: string, returnUrl: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

/** Pausa el cobro de la suscripción (no la cancela): Stripe deja de cobrar y
 *  anula las facturas generadas mientras esté pausada. */
export async function pauseSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: { behavior: "void" },
  });
}

/** Reanuda el cobro de una suscripción previamente pausada (limpia pause_collection). */
export async function resumeSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: null as any,
  });
}

/**
 * Reembolsa un cobro de Stripe a partir de una referencia (pi_… / ch_… / py_… / in_…).
 * `amountMxn` opcional para reembolso parcial; el motivo libre va a metadata
 * (Stripe.reason solo acepta un enum cerrado, no texto libre).
 */
export async function refundPayment(
  reference: string,
  amountMxn?: number,
  reason?: string,
): Promise<void> {
  const stripe = getStripe();
  const params: any = {
    reason: "requested_by_customer",
    metadata: { adminReason: (reason ?? "").slice(0, 200) },
  };
  if (amountMxn && amountMxn > 0) params.amount = Math.round(amountMxn * 100);

  if (reference.startsWith("pi_")) {
    params.payment_intent = reference;
  } else if (reference.startsWith("ch_") || reference.startsWith("py_")) {
    params.charge = reference;
  } else if (reference.startsWith("in_")) {
    const invoice = await stripe.invoices.retrieve(reference);
    const pi = (invoice as any).payment_intent;
    if (!pi) throw new Error("La factura de Stripe no tiene un pago asociado para reembolsar");
    params.payment_intent = typeof pi === "string" ? pi : pi.id;
  } else {
    throw new Error("Referencia de Stripe no reconocida para reembolso");
  }

  await stripe.refunds.create(params);
}
