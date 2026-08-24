import { NextResponse } from "next/server";
import {
  createMembershipCheckoutSession,
  isBarberStripeConfigured,
  syncMembershipCheckout,
} from "@/lib/barber/payments";
import { barberApiError, readJson, requireBarberApi } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * Cobro de la membresía con TARJETA. `recurring: true` (default) crea una
 * suscripción real en Stripe que se renueva sola cada periodo; `false` cobra
 * una sola vez.
 *
 * La membresía del cliente NO se crea aquí: nace cuando Stripe confirma el
 * cobro (webhook payment_intent.succeeded o el PUT de retorno). Así nunca
 * queda una membresía activa sin dinero detrás.
 */
export async function POST(req: Request) {
  const g = await requireBarberApi({ permission: "memberships.manage", feature: "memberships" });
  if (!g.ok) return g.res;
  try {
    if (!isBarberStripeConfigured()) {
      return NextResponse.json(
        {
          error:
            "El cobro con tarjeta todavía no está configurado. Puedes vender la membresía en efectivo o por transferencia.",
          code: "STRIPE_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }

    const body = await readJson(req);
    const clientId = typeof body.clientId === "string" ? body.clientId : "";
    const membershipId = typeof body.membershipId === "string" ? body.membershipId : "";
    if (!clientId) return NextResponse.json({ error: "Elige un cliente." }, { status: 400 });
    if (!membershipId) return NextResponse.json({ error: "Elige una membresía." }, { status: 400 });

    const out = await createMembershipCheckoutSession({
      barbershopId: g.ctx.barbershopId,
      clientId,
      membershipId,
      recurring: body.recurring !== false,
    });
    return NextResponse.json(out);
  } catch (err) {
    return barberApiError(err);
  }
}

/**
 * Confirmación al volver de Stripe. Redundante con el webhook a propósito:
 * si el cliente cierra la pestaña el webhook activa igual, y si el webhook
 * tarda esto la activa al instante. Es idempotente.
 */
export async function PUT(req: Request) {
  const g = await requireBarberApi({ permission: "memberships.manage", feature: "memberships" });
  if (!g.ok) return g.res;
  try {
    const body = await readJson(req);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) return NextResponse.json({ error: "Falta la sesión de pago." }, { status: 400 });
    const out = await syncMembershipCheckout({
      barbershopId: g.ctx.barbershopId,
      sessionId,
    });
    return NextResponse.json(out);
  } catch (err) {
    return barberApiError(err);
  }
}
