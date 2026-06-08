import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { createWalletSetupIntent } from "@/lib/ai-billing/recharge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai-wallet/stripe/setup-intent
 *
 * Crea un SetupIntent para guardar una tarjeta (auto-recarga del monedero de IA).
 * El cliente confirma con Stripe.js y luego llama a `/confirm` para persistirla.
 * Solo admin. Multi-tenant: clinicId SIEMPRE de la sesión, nunca del body.
 */
export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });

  if (!getStripeSafe()) return NextResponse.json(stripeUnavailableResponse(), { status: 503 });

  try {
    const { clientSecret } = await createWalletSetupIntent(ctx.clinicId);
    return NextResponse.json({ clientSecret });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error creando SetupIntent" }, { status: 500 });
  }
}
