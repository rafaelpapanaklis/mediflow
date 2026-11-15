// ═══════════════════════════════════════════════════════════════════════
// /api/barber/appointments/[id]/draft-items — productos al cobro desde la cita
//
// Cita «B» (ws6-t5). Los productos viven en la nota «Por cobrar» LIGADA a la
// cita (appointment-draft.ts): al «Completar y cobrar» el ticket ya los trae.
// Las existencias se descuentan al COBRAR, no antes.
//
//   GET                         → { ready, draftId, items: [{ productId, name, qty, unitPrice, stock }] }
//   POST   { productId, qty? }  → agrega (si ya estaba, suma; tope 99)
//   DELETE { productId }        → quita (sin productos, la nota se descarta)
//
// QUIÉN: ver = agenda.view (y el Barbero, solo en su visita); agregar y quitar
// = agenda.edit o el Barbero en SU visita. Plan con `products`.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { BarberCajaError } from "@/lib/barber/commissions";
import {
  addAppointmentDraftItem,
  getAppointmentDraft,
  removeAppointmentDraftItem,
} from "@/lib/barber/appointment-draft";
import { scopeAppointmentsWhere, agendaViewScope, scopeUserFromCtx } from "@/lib/barber/own-visits";
import { canActOnOwnVisit, jsonError, openAgendaGate, readJson } from "../../_server";

export const dynamic = "force-dynamic";

async function open(req: Request, id: string, write: boolean) {
  const branchId = new URL(req.url).searchParams.get("branchId");
  const gate = await openAgendaGate({ permission: "agenda.view", feature: "agenda", branchId });
  if (gate.response) return { error: gate.response };
  const { shopId, ctx, plan } = gate.gate;
  if (!barberPlanHasFeature(plan, "products")) {
    return { error: jsonError("Tu plan no incluye productos.", 403, { code: "PLAN_FEATURE", feature: "products" }) };
  }
  const appt = await prisma.barberAppointment.findFirst({
    where: { id, barbershopId: shopId, ...scopeAppointmentsWhere(agendaViewScope(scopeUserFromCtx(ctx))) },
    select: { id: true, barberId: true },
  });
  if (!appt) return { error: jsonError("Esa visita no existe.", 404) };
  if (write && !canActOnOwnVisit(ctx, appt)) {
    return { error: jsonError("No tienes permiso para esto.", 403, { code: "FORBIDDEN", permission: "agenda.edit" }) };
  }
  return { shopId, userId: ctx.barberUserId, appointmentId: appt.id };
}

function cajaError(e: unknown) {
  if (e instanceof BarberCajaError) return jsonError(e.message, e.status, { code: e.code });
  console.error("[api/barber/appointments/draft-items]", e);
  return jsonError("Algo salió mal. Inténtalo otra vez.", 500);
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const o = await open(req, (await props.params).id, false);
  if ("error" in o) return o.error;
  return NextResponse.json(await getAppointmentDraft(o.shopId, o.appointmentId), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const o = await open(req, (await props.params).id, true);
  if ("error" in o) return o.error;
  const body = (await readJson(req)) ?? {};
  try {
    const view = await addAppointmentDraftItem({
      barbershopId: o.shopId,
      appointmentId: o.appointmentId,
      userId: o.userId,
      productId: body.productId,
      qty: body.qty,
    });
    return NextResponse.json(view, { status: 201 });
  } catch (e) {
    return cajaError(e);
  }
}

export async function DELETE(req: Request, props: { params: Promise<{ id: string }> }) {
  const o = await open(req, (await props.params).id, true);
  if ("error" in o) return o.error;
  const body = (await readJson(req)) ?? {};
  const productId = body.productId ?? new URL(req.url).searchParams.get("productId");
  try {
    return NextResponse.json(
      await removeAppointmentDraftItem({ barbershopId: o.shopId, appointmentId: o.appointmentId, userId: o.userId, productId }),
    );
  } catch (e) {
    return cajaError(e);
  }
}
