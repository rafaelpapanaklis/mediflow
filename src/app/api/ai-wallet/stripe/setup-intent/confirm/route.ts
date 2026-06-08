import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { saveCardFromSetupIntent } from "@/lib/ai-billing/recharge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ setupIntentId: z.string().min(1) });

/**
 * POST /api/ai-wallet/stripe/setup-intent/confirm  { setupIntentId }
 *
 * Tras confirmar la tarjeta en el cliente, persiste el PaymentMethod en el
 * monedero (AiWallet.stripePaymentMethodId). Solo admin. clinicId de la sesión.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });

  if (!getStripeSafe()) return NextResponse.json(stripeUnavailableResponse(), { status: 503 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "setupIntentId requerido" }, { status: 400 });
  }

  try {
    const result = await saveCardFromSetupIntent(ctx.clinicId, parsed.data.setupIntentId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "No se pudo guardar la tarjeta" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, brand: result.brand, last4: result.last4 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error guardando tarjeta" }, { status: 500 });
  }
}
