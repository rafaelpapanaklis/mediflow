import { NextResponse } from "next/server";
import {
  forfeitDeposit,
  isCounterPaymentMethod,
  listDepositCandidates,
  listDeposits,
  markDepositPaidManually,
  refundDeposit,
  type DepositListFilter,
} from "@/lib/barber/payments";
import { barberApiError, readJson, requireBarberApi } from "../../memberships/_guard";

export const dynamic = "force-dynamic";

const FILTERS: DepositListFilter[] = ["all", "pending", "paid", "closed"];

/**
 * Los anticipos de la barbería, con su estado y si ya se aplicaron al ticket.
 * Con `?candidates=1` devuelve, en cambio, las citas a las que se les puede
 * registrar un anticipo en mostrador (para quien puede cobrar).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const wantsCandidates = url.searchParams.get("candidates") === "1";
  const g = await requireBarberApi({
    permission: wantsCandidates ? "cash.manage" : "cash.view",
    feature: "deposits",
  });
  if (!g.ok) return g.res;
  try {
    if (wantsCandidates) {
      const candidates = await listDepositCandidates(g.ctx.barbershopId);
      return NextResponse.json({ candidates }, { headers: { "Cache-Control": "no-store" } });
    }
    const raw = url.searchParams.get("filter") ?? "all";
    const filter = (FILTERS.includes(raw as DepositListFilter) ? raw : "all") as DepositListFilter;
    const items = await listDeposits(g.ctx.barbershopId, { filter });
    return NextResponse.json({ items });
  } catch (err) {
    return barberApiError(err);
  }
}

/**
 * El cliente no llegó: la barbería decide. `refund` devuelve: en mostrador
 * exige turno abierto y registra un ticket NEGATIVO «Devolución de anticipo»
 * en el turno de hoy con su método (`paymentMethod`, por defecto el mismo con
 * que se cobró); si el cobro fue con tarjeta en línea, reembolsa en Stripe.
 * `forfeit` lo retiene. `mark-paid` registra
 * un anticipo cobrado en mostrador: exige turno abierto y método de pago
 * (CASH | SPEI | CARD) y deja su ticket en el corte. Las tres dejan registro.
 */
export async function POST(req: Request) {
  const g = await requireBarberApi({ permission: "cash.manage", feature: "deposits" });
  if (!g.ok) return g.res;
  try {
    const body = await readJson(req);
    const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!appointmentId) {
      return NextResponse.json({ error: "Falta la cita." }, { status: 400 });
    }

    const actorName = `${g.ctx.user.firstName} ${g.ctx.user.lastName}`.trim();

    if (action === "refund") {
      // El método es opcional (por defecto, el mismo con que se cobró), pero
      // si llega tiene que ser uno de mostrador.
      const refundMethod = body.paymentMethod ?? undefined;
      if (refundMethod !== undefined && !isCounterPaymentMethod(refundMethod)) {
        return NextResponse.json(
          { error: "Elige cómo devuelves el anticipo: efectivo, transferencia o tarjeta en mostrador.", code: "INVALID_PAYMENT_METHOD" },
          { status: 400 },
        );
      }
      const out = await refundDeposit({
        barbershopId: g.ctx.barbershopId,
        appointmentId,
        actorName,
        actorUserId: g.ctx.barberUserId,
        paymentMethod: refundMethod,
      });
      return NextResponse.json(out);
    }

    if (action === "forfeit") {
      const out = await forfeitDeposit({
        barbershopId: g.ctx.barbershopId,
        appointmentId,
        actorName,
      });
      return NextResponse.json(out);
    }

    if (action === "mark-paid") {
      if (!isCounterPaymentMethod(body.paymentMethod)) {
        return NextResponse.json(
          { error: "Elige cómo pagó: efectivo, transferencia o tarjeta en mostrador.", code: "INVALID_PAYMENT_METHOD" },
          { status: 400 },
        );
      }
      const out = await markDepositPaidManually({
        barbershopId: g.ctx.barbershopId,
        appointmentId,
        amount: (body.amount as string | number) ?? 0,
        paymentMethod: body.paymentMethod,
        soldByUserId: g.ctx.barberUserId,
      });
      return NextResponse.json({ ok: true, ...out });
    }

    return NextResponse.json({ error: "Acción no válida." }, { status: 400 });
  } catch (err) {
    return barberApiError(err);
  }
}
