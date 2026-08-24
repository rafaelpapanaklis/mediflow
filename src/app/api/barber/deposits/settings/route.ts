import { NextResponse } from "next/server";
import {
  describeDepositPolicy,
  getBarberPaymentSettings,
  isBarberStripeConfigured,
  saveBarberDepositPolicy,
  computeDepositCents,
  BARBER_CURRENCY,
} from "@/lib/barber/payments";
import { barberApiError, readJson, requireBarberApi } from "../../memberships/_guard";

export const dynamic = "force-dynamic";

/** Ejemplo con el que la barbería ve cuánto pediría en un servicio de $300. */
const SAMPLE_SERVICE_CENTS = 30_000;

export async function GET() {
  const g = await requireBarberApi({ permission: "settings.edit", feature: "deposits" });
  if (!g.ok) return g.res;
  try {
    const { policy, storageReady } = await getBarberPaymentSettings(g.ctx.barbershopId);
    const sampleCents = computeDepositCents(policy, SAMPLE_SERVICE_CENTS);
    return NextResponse.json({
      policy,
      storageReady,
      stripeConfigured: isBarberStripeConfigured(),
      preview: {
        serviceCents: SAMPLE_SERVICE_CENTS,
        depositCents: sampleCents,
        text: describeDepositPolicy(policy, {
          amountCents: sampleCents,
          currency: BARBER_CURRENCY,
          locale: g.ctx.barbershop.locale,
        }),
      },
    });
  } catch (err) {
    return barberApiError(err);
  }
}

export async function PUT(req: Request) {
  const g = await requireBarberApi({ permission: "settings.edit", feature: "deposits" });
  if (!g.ok) return g.res;
  try {
    const policy = await saveBarberDepositPolicy(g.ctx.barbershopId, await readJson(req));
    return NextResponse.json({ policy, ok: true });
  } catch (err) {
    return barberApiError(err);
  }
}
