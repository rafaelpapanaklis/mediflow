import { NextResponse } from "next/server";
import {
  getMembershipStats,
  listClientMemberships,
  renewClientMembership,
  sellMembership,
  setClientMembershipStatus,
  type MembershipListFilter,
} from "@/lib/barber/memberships";
import { cancelMembershipSubscription } from "@/lib/barber/payments";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { barberApiError, readJson, requireBarberApi } from "../_guard";

export const dynamic = "force-dynamic";

const FILTERS: MembershipListFilter[] = ["all", "active", "soon", "expired"];
/** STRIPE no entra: ese camino nace del cobro en línea, no de un alta a mano. */
const MANUAL_METHODS: BarberPaymentMethod[] = ["CASH", "SPEI", "CARD"];

/** Las membresías vendidas: vigentes, por vencer y vencidas. */
export async function GET(req: Request) {
  const g = await requireBarberApi({ permission: "memberships.manage", feature: "memberships" });
  if (!g.ok) return g.res;
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("filter") ?? "all";
    const filter = (FILTERS.includes(raw as MembershipListFilter) ? raw : "all") as MembershipListFilter;

    const [items, stats] = await Promise.all([
      listClientMemberships(g.ctx.barbershopId, {
        filter,
        q: url.searchParams.get("q") ?? "",
      }),
      getMembershipStats(g.ctx.barbershopId),
    ]);
    return NextResponse.json({ items, stats });
  } catch (err) {
    return barberApiError(err);
  }
}

/** Vender una membresía cobrada en efectivo, SPEI o tarjeta de mostrador. */
export async function POST(req: Request) {
  const g = await requireBarberApi({ permission: "memberships.manage", feature: "memberships" });
  if (!g.ok) return g.res;
  try {
    const body = await readJson(req);
    const clientId = typeof body.clientId === "string" ? body.clientId : "";
    const membershipId = typeof body.membershipId === "string" ? body.membershipId : "";
    const method = body.paymentMethod as BarberPaymentMethod;

    if (!clientId) return NextResponse.json({ error: "Elige un cliente." }, { status: 400 });
    if (!membershipId) return NextResponse.json({ error: "Elige una membresía." }, { status: 400 });
    if (!MANUAL_METHODS.includes(method)) {
      return NextResponse.json(
        { error: "Elige cómo pagó: efectivo, transferencia o tarjeta." },
        { status: 400 },
      );
    }

    const created = await sellMembership({
      barbershopId: g.ctx.barbershopId,
      clientId,
      membershipId,
      paymentMethod: method,
    });
    return NextResponse.json({ membership: created }, { status: 201 });
  } catch (err) {
    return barberApiError(err);
  }
}

/** Renovar, pausar, reactivar o cancelar una membresía vendida. */
export async function PATCH(req: Request) {
  const g = await requireBarberApi({ permission: "memberships.manage", feature: "memberships" });
  if (!g.ok) return g.res;
  try {
    const body = await readJson(req);
    const id = typeof body.id === "string" ? body.id : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!id) return NextResponse.json({ error: "Falta el id de la membresía." }, { status: 400 });

    if (action === "renew") {
      const method = MANUAL_METHODS.includes(body.paymentMethod as BarberPaymentMethod)
        ? (body.paymentMethod as BarberPaymentMethod)
        : undefined;
      const membership = await renewClientMembership({
        barbershopId: g.ctx.barbershopId,
        clientMembershipId: id,
        paymentMethod: method,
      });
      return NextResponse.json({ membership });
    }

    if (action === "cancel") {
      // Si se cobraba sola con tarjeta, primero se corta en Stripe.
      const stripe = await cancelMembershipSubscription({
        barbershopId: g.ctx.barbershopId,
        clientMembershipId: id,
      });
      await setClientMembershipStatus({
        barbershopId: g.ctx.barbershopId,
        clientMembershipId: id,
        status: "CANCELLED",
      });
      return NextResponse.json({ ok: true, stripeCancelled: stripe.cancelled });
    }

    if (action === "pause" || action === "resume") {
      await setClientMembershipStatus({
        barbershopId: g.ctx.barbershopId,
        clientMembershipId: id,
        status: action === "pause" ? "PAUSED" : "ACTIVE",
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Acción no válida." }, { status: 400 });
  } catch (err) {
    return barberApiError(err);
  }
}
