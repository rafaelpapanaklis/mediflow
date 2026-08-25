import { NextResponse, type NextRequest } from "next/server";
import { getRealtyBillingSummary, getRealtyUsage } from "@/lib/realty/billing";
import { getRealtyPlan } from "@/lib/realty/plans";
import { realtyUsageStates } from "@/lib/realty/gating";
import { realtyBillingErrorResponse, requireRealtyBilling } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/realty/billing/status — estado + consumo, para refrescar la
 * pantalla sin recargar. No exige Stripe: si no está configurado, responde
 * igual con lo que hay en la base y lo dice.
 */
export async function GET(_req: NextRequest) {
  const auth = await requireRealtyBilling();
  if (auth instanceof NextResponse) return auth;

  try {
    const [summary, usage, plan] = await Promise.all([
      getRealtyBillingSummary(auth.account),
      getRealtyUsage(auth.account.id),
      getRealtyPlan(auth.account.plan),
    ]);
    const states = realtyUsageStates(plan, usage, auth.ctx.account);
    return NextResponse.json({
      ...summary,
      usage,
      // `remaining` se queda fuera a propósito: vale Infinity cuando el cupo
      // es ilimitado y JSON.stringify lo convierte en null, que se lee como
      // "no queda nada" — justo lo contrario. `unlimited` ya lo dice.
      limits: Object.values(states).map(({ remaining, ...rest }) => rest),
    });
  } catch (err) {
    return realtyBillingErrorResponse(err);
  }
}
