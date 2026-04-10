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
      name: `MediFlow ${params.plan}`,
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
        product_data: { name: `MediFlow Plan ${params.plan}` },
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
    description: `MediFlow — ${params.clinicName}`,
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
