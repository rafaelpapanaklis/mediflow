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
import {
  BARBER_SUPPORT_PATH,
  barberSupportWhatsappUrl,
  dalecontrolWhatsappDisplay,
} from "@/lib/barber/marketing";

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

/**
 * Mapea errores de gate (plan/rol) y de cobro a JSON; lo demás es 500 sin
 * filtrar detalles.
 *
 * El 500 NO puede ser un error mudo (auditoría 14-nov, G4): quien intenta
 * pagar y falla tiene que saber a quién escribirle. El motivo real se queda
 * en el log; al cliente le llega el mensaje y, en `support`, las dos salidas
 * (el ticket de /barber/soporte y el WhatsApp oficial de DaleControl). La
 * pantalla de Suscripción las pinta como botones.
 */
export function billingErrorResponse(err: unknown): NextResponse {
  const gate = barberGateErrorPayload(err);
  if (gate) return NextResponse.json(gate.body, { status: gate.status });
  const billing = barberBillingErrorPayload(err);
  if (billing) return NextResponse.json(billing.body, { status: billing.status });
  console.error("[barber billing]", err);
  return NextResponse.json(
    {
      error:
        "No pudimos procesar el cobro. Intenta de nuevo; si vuelve a fallar, escríbenos y lo resolvemos contigo.",
      code: "INTERNAL",
      support: {
        path: BARBER_SUPPORT_PATH,
        whatsapp: dalecontrolWhatsappDisplay(),
        whatsappUrl: barberSupportWhatsappUrl(),
      },
    },
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
