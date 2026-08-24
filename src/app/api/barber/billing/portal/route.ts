import { NextResponse, type NextRequest } from "next/server";
import { createBarberPortalSession, resolveBarberBaseUrl } from "@/lib/barber/billing";
import { billingErrorResponse, requireBarberBilling, requireBarberStripe } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/barber/billing/portal
 * Sesión del portal de facturación de Stripe con la configuración PROPIA de
 * barber (actualizar tarjeta, ver/pagar facturas, datos de contacto). Sin
 * cambio de plan ni cancelación dentro de Stripe: eso vive en
 * /barber/suscripcion. Solo billing.manage (la sesión muestra importes).
 */
export async function POST(req: NextRequest) {
  const auth = await requireBarberBilling();
  if (auth instanceof NextResponse) return auth;
  const stripe = requireBarberStripe();
  if (stripe instanceof NextResponse) return stripe;
  try {
    const url = await createBarberPortalSession(
      stripe,
      auth.shop,
      `${resolveBarberBaseUrl(req.url)}/barber/suscripcion`,
    );
    return NextResponse.json({ url });
  } catch (err) {
    return billingErrorResponse(err);
  }
}
