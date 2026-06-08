import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { createTopupCheckout, MIN_TOPUP_CENTS, MAX_TOPUP_CENTS } from "@/lib/ai-billing/recharge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  amountCents: z.number().int().min(MIN_TOPUP_CENTS).max(MAX_TOPUP_CENTS),
});

/**
 * POST /api/ai-wallet/stripe/checkout  { amountCents }
 *
 * Crea una Stripe Checkout Session (hosted, MXN) para recargar el monedero de IA.
 * La acreditación real ocurre en el webhook (payment_intent.succeeded, kind=ai-topup),
 * idempotente. Solo admin. clinicId de la sesión, nunca del body.
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
    return NextResponse.json(
      { error: `Monto inválido (mín $${MIN_TOPUP_CENTS / 100} / máx $${MAX_TOPUP_CENTS / 100} MXN)` },
      { status: 400 },
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? new URL(req.url).origin;

  try {
    const { url } = await createTopupCheckout({
      clinicId: ctx.clinicId,
      amountCents: parsed.data.amountCents,
      successUrl: `${baseUrl}/dashboard?airecarga=ok`,
      cancelUrl: `${baseUrl}/dashboard?airecarga=cancel`,
    });
    return NextResponse.json({ url });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error creando checkout" }, { status: 500 });
  }
}
