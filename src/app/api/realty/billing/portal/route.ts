import { NextResponse, type NextRequest } from "next/server";
import { createRealtyPortalSession, resolveRealtyBaseUrl } from "@/lib/realty/billing";
import { realtyBillingErrorResponse, requireRealtyBilling, requireRealtyStripe } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/realty/billing/portal — portal de Stripe para CAMBIAR LA TARJETA
 * y ver las facturas. El cambio de plan y la cancelación NO viven ahí: están
 * en /inmobiliaria/suscripcion, con prorrateo y límites propios (y así una
 * inmobiliaria nunca ve el catálogo del dental dentro del portal).
 */
export async function POST(req: NextRequest) {
  const auth = await requireRealtyBilling();
  if (auth instanceof NextResponse) return auth;
  const stripe = requireRealtyStripe();
  if (stripe instanceof NextResponse) return stripe;

  try {
    const url = await createRealtyPortalSession(
      stripe,
      auth.account,
      `${resolveRealtyBaseUrl(req.url)}/inmobiliaria/suscripcion`,
    );
    return NextResponse.json({ url });
  } catch (err) {
    return realtyBillingErrorResponse(err);
  }
}
