import { NextResponse } from "next/server";
import {
  forfeitDeposit,
  listDeposits,
  markDepositPaidManually,
  refundDeposit,
  type DepositListFilter,
} from "@/lib/barber/payments";
import { barberApiError, readJson, requireBarberApi } from "../../memberships/_guard";

export const dynamic = "force-dynamic";

const FILTERS: DepositListFilter[] = ["all", "pending", "paid", "closed"];

/** Los anticipos de la barbería, con su estado y si ya se aplicaron al ticket. */
export async function GET(req: Request) {
  const g = await requireBarberApi({ permission: "cash.view", feature: "deposits" });
  if (!g.ok) return g.res;
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("filter") ?? "all";
    const filter = (FILTERS.includes(raw as DepositListFilter) ? raw : "all") as DepositListFilter;
    const items = await listDeposits(g.ctx.barbershopId, { filter });
    return NextResponse.json({ items });
  } catch (err) {
    return barberApiError(err);
  }
}

/**
 * El cliente no llegó: la barbería decide. `refund` devuelve (y reembolsa en
 * Stripe si el cobro fue con tarjeta); `forfeit` lo retiene. `mark-paid`
 * registra un anticipo cobrado en mostrador. Las tres dejan registro.
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
      const out = await refundDeposit({
        barbershopId: g.ctx.barbershopId,
        appointmentId,
        actorName,
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
      await markDepositPaidManually({
        barbershopId: g.ctx.barbershopId,
        appointmentId,
        amount: (body.amount as string | number) ?? 0,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Acción no válida." }, { status: 400 });
  } catch (err) {
    return barberApiError(err);
  }
}
