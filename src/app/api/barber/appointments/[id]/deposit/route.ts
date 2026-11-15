// ═══════════════════════════════════════════════════════════════════════
// /api/barber/appointments/[id]/deposit — anticipo desde la cita (cita «B»)
//
// El MISMO registro de Membresías → Anticipos («mark-paid» de
// /api/barber/deposits/actions → markDepositPaidManually), solo que desde la
// cita: exige turno abierto, crea su ticket «Anticipo recibido» en el corte
// del día con su método, y deja el anticipo PAGADO en la cita (que el cobro
// descuenta solo). Todo en una transacción con la cita bloqueada.
//
//   GET                            → { status, amount, totalOfServices, canRegister }
//   POST { amount, paymentMethod } → registra el anticipo cobrado en mostrador
//
// QUIÉN: ver = cash.view; registrar = cash.manage (Recepción incluida). Plan
// con `deposits`. La sede es la de la sesión (o la de la pantalla).
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { isSaleCancelled, toNum } from "@/lib/barber/commissions";
import { BarberPaymentsError, markDepositPaidManually } from "@/lib/barber/payments";
import { isCounterPaymentMethod } from "@/lib/barber/payments-core";
import { jsonError, openAgendaGate, readJson } from "../../_server";

export const dynamic = "force-dynamic";

async function open(req: Request, id: string, permission: "cash.view" | "cash.manage") {
  const branchId = new URL(req.url).searchParams.get("branchId");
  const gate = await openAgendaGate({ permission: "agenda.view", feature: "agenda", branchId });
  if (gate.response) return { error: gate.response };
  const { shopId, ctx, plan } = gate.gate;
  if (!barberPlanHasFeature(plan, "deposits")) {
    return { error: jsonError("Tu plan no incluye anticipos.", 403, { code: "PLAN_FEATURE", feature: "deposits" }) };
  }
  if (!hasBarberPermission({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride }, permission)) {
    return { error: jsonError("No tienes permiso para esto.", 403, { code: "FORBIDDEN", permission }) };
  }
  const appt = await prisma.barberAppointment.findFirst({
    where: { id, barbershopId: shopId },
    select: {
      id: true,
      status: true,
      depositAmount: true,
      depositStatus: true,
      services: { select: { priceAtBooking: true } },
      sales: { select: { notes: true } },
    },
  });
  if (!appt) return { error: jsonError("Esa visita no existe.", 404) };
  return { shopId, ctx, appt };
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const o = await open(req, (await props.params).id, "cash.view");
  if ("error" in o) return o.error;
  const { appt } = o;
  const charged = appt.sales.some((s) => !isSaleCancelled(s));
  const closed = appt.status === "CANCELLED" || appt.status === "NO_SHOW";
  const total = appt.services.reduce((sum, s) => sum + toNum(s.priceAtBooking), 0);
  return NextResponse.json(
    {
      status: appt.depositStatus,
      amount: appt.depositAmount === null ? null : toNum(appt.depositAmount),
      totalOfServices: Math.round(total * 100) / 100,
      // Lo mismo que valida markDepositPaidManually: cita abierta, sin cobrar
      // y sin anticipo pagado, devuelto ni retenido.
      canRegister:
        !closed && !charged && appt.depositStatus !== "PAID" && appt.depositStatus !== "REFUNDED" && appt.depositStatus !== "FORFEITED",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const o = await open(req, (await props.params).id, "cash.manage");
  if ("error" in o) return o.error;
  const body = (await readJson(req)) ?? {};
  if (!isCounterPaymentMethod(body.paymentMethod)) {
    return jsonError("Elige cómo pagó: efectivo, transferencia o tarjeta en mostrador.", 400, { code: "INVALID_PAYMENT_METHOD" });
  }
  try {
    const out = await markDepositPaidManually({
      barbershopId: o.shopId,
      appointmentId: o.appt.id,
      amount: (body.amount as string | number) ?? 0,
      paymentMethod: body.paymentMethod,
      soldByUserId: o.ctx.barberUserId,
    });
    return NextResponse.json({ ok: true, ...out, status: "PAID" }, { status: 201 });
  } catch (e) {
    if (e instanceof BarberPaymentsError) return jsonError(e.message, e.status, { code: e.code });
    console.error("[api/barber/appointments/deposit]", e);
    return jsonError("Algo salió mal. Inténtalo otra vez.", 500);
  }
}
