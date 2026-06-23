import { getAdminSession } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, getPriceIdForPlan, stripeUnavailableResponse } from "@/lib/stripe";
import { logAdminClinicMutation } from "@/lib/admin-audit";


export async function POST(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stripe = getStripeSafe();
  if (!stripe) return NextResponse.json(stripeUnavailableResponse(), { status: 503 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const clinicId = String(body?.clinicId ?? "");
  const plan     = String(body?.plan ?? "PRO");
  if (!clinicId) return NextResponse.json({ error: "clinicId requerido" }, { status: 400 });

  const priceId = getPriceIdForPlan(plan);
  if (!priceId) {
    return NextResponse.json(
      { error: `STRIPE_PRICE_ID_${plan} no configurado en Vercel` },
      { status: 503 },
    );
  }

  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  let customerId = clinic.stripeCustomerId ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: clinic.email ?? undefined,
      name:  clinic.name,
      metadata: { clinicId: clinic.id },
    });
    customerId = customer.id;
    await prisma.clinic.update({ where: { id: clinic.id }, data: { stripeCustomerId: customer.id } });
  }

  // Checkout Session para cobro recurrente — el URL devuelto se copia y se
  // envía al cliente para que complete el pago.
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.dalecontrol.com"}/dashboard/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.dalecontrol.com"}/dashboard/billing/cancel`,
    metadata: { clinicId: clinic.id, plan },
  });

  await logAdminClinicMutation({
    req, admin: admin.user, clinicId: clinic.id,
    entityType: "admin-billing", entityId: clinic.id, action: "update",
    after: { op: "create_subscription_checkout", plan, stripeCustomerId: customerId, sessionId: session.id },
  });

  return NextResponse.json({ url: session.url, sessionId: session.id });
}
