import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { assertBarberPermission, getBarberContext, type BarberContext } from "@/lib/barber-auth";
import { barberGateErrorPayload } from "@/lib/barber/gating";
import {
  barberBillingErrorPayload,
  barberStripeUnavailable,
  getBarberBillingShop,
  getBarberStripe,
  type BarberBillingShop,
} from "@/lib/barber/billing";

/**
 * Helpers compartidos por las rutas /api/barber/billing/*. No es una ruta
 * (no se llama route.ts). Toda ruta de cobro exige sesión de barbería +
 * permiso billing.manage (OWNER por default) y opera sobre la MATRIZ.
 */

export interface BarberBillingAuth {
  ctx: BarberContext;
  shop: BarberBillingShop;
}

export async function requireBarberBilling(): Promise<BarberBillingAuth | NextResponse> {
  const ctx = await getBarberContext();
  if (!ctx) {
    return NextResponse.json({ error: "No autorizado", code: "UNAUTHENTICATED" }, { status: 401 });
  }
  try {
    assertBarberPermission(ctx, "billing.manage");
    const shop = await getBarberBillingShop(ctx);
    return { ctx, shop };
  } catch (err) {
    return billingErrorResponse(err);
  }
}

export function requireBarberStripe(): Stripe | NextResponse {
  const stripe = getBarberStripe();
  if (!stripe) return NextResponse.json(barberStripeUnavailable(), { status: 503 });
  return stripe;
}

/** Mapea errores de gate (plan/rol) y de cobro a JSON; lo demás es 500 sin filtrar detalles. */
export function billingErrorResponse(err: unknown): NextResponse {
  const gate = barberGateErrorPayload(err);
  if (gate) return NextResponse.json(gate.body, { status: gate.status });
  const billing = barberBillingErrorPayload(err);
  if (billing) return NextResponse.json(billing.body, { status: billing.status });
  console.error("[barber billing]", err);
  return NextResponse.json(
    { error: "Algo falló al procesar el cobro. Intenta de nuevo.", code: "INTERNAL" },
    { status: 500 },
  );
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
