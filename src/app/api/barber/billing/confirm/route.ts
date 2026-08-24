import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isBarbershopSubscriptionActive } from "@/lib/barber/plan-shared";
import { confirmBarberCheckoutSession, prismaBillingDb } from "@/lib/barber/billing";
import { billingErrorResponse, readJsonBody, requireBarberBilling, requireBarberStripe } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/barber/billing/confirm  { sessionId }
 *
 * Al volver de Stripe Checkout. Verifica que la sesión sea de barber y de
 * ESTA barbería, lee la suscripción y la aplica por la MISMA ruta que el
 * webhook (idempotente) — así el acceso se abre aunque el webhook tarde, y
 * nadie paga dos veces creyendo que falló. Devuelve `active` leído de la BD.
 */
export async function POST(req: NextRequest) {
  const auth = await requireBarberBilling();
  if (auth instanceof NextResponse) return auth;
  const stripe = requireBarberStripe();
  if (stripe instanceof NextResponse) return stripe;

  const body = await readJsonBody(req);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return NextResponse.json({ error: "Sesión inválida.", code: "INVALID_SESSION" }, { status: 400 });
  }

  try {
    const result = await confirmBarberCheckoutSession(stripe, prismaBillingDb(), auth.shop, sessionId);
    const fresh = await prisma.barbershop.findUnique({
      where: { id: auth.shop.id },
      select: { subscriptionStatus: true },
    });
    return NextResponse.json({
      ...result,
      active: isBarbershopSubscriptionActive(fresh),
      subscriptionStatus: fresh?.subscriptionStatus ?? null,
    });
  } catch (err) {
    return billingErrorResponse(err);
  }
}
