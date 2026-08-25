import { NextResponse, type NextRequest } from "next/server";
import { prismaRealtyBillingDb, setRealtySubscriptionCancel } from "@/lib/realty/billing";
import { getRealtyPlans } from "@/lib/realty/plans";
import { realtyBillingErrorResponse, requireRealtyBilling, requireRealtyStripe } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/realty/billing/resume — deshace la cancelación programada. */
export async function POST(_req: NextRequest) {
  const auth = await requireRealtyBilling();
  if (auth instanceof NextResponse) return auth;
  const stripe = requireRealtyStripe();
  if (stripe instanceof NextResponse) return stripe;

  try {
    const plans = await getRealtyPlans();
    const result = await setRealtySubscriptionCancel(
      stripe,
      prismaRealtyBillingDb(),
      auth.account,
      false,
      plans,
    );
    return NextResponse.json(result);
  } catch (err) {
    return realtyBillingErrorResponse(err);
  }
}
