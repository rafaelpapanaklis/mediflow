import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createCustomer, createCheckoutForSubscription, cancelSubscription, getCustomerPortalUrl } from "@/lib/stripe-subscriptions";

function isAdmin(req: NextRequest): boolean {
  const token = req.cookies.get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { action, clinicId } = body;

    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { id: true, name: true, email: true, plan: true, stripeCustomerId: true, stripeSubscriptionId: true },
    });
    if (!clinic) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

    if (action === "create_subscription") {
      let customerId = clinic.stripeCustomerId;
      if (!customerId) {
        customerId = await createCustomer(clinic.email ?? "", clinic.name);
        await prisma.clinic.update({ where: { id: clinicId }, data: { stripeCustomerId: customerId } });
      }

      const url = await createCheckoutForSubscription({
        customerId,
        plan: body.plan ?? clinic.plan,
        clinicId,
        successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?stripe=subscription_success`,
        cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?stripe=subscription_cancelled`,
      });

      return NextResponse.json({ url });
    }

    if (action === "cancel_subscription") {
      if (!clinic.stripeSubscriptionId) return NextResponse.json({ error: "No active subscription" }, { status: 400 });
      await cancelSubscription(clinic.stripeSubscriptionId);
      await prisma.clinic.update({
        where: { id: clinicId },
        data: { subscriptionStatus: "cancelled", stripeSubscriptionId: null },
      });
      return NextResponse.json({ success: true });
    }

    if (action === "customer_portal") {
      if (!clinic.stripeCustomerId) return NextResponse.json({ error: "No Stripe customer" }, { status: 400 });
      const url = await getCustomerPortalUrl(clinic.stripeCustomerId, `${process.env.NEXT_PUBLIC_APP_URL}/admin/payments`);
      return NextResponse.json({ url });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin Stripe error:", error);
    return NextResponse.json({ error: error.message ?? "Internal error" }, { status: 500 });
  }
}
