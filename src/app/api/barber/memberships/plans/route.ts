import { NextResponse } from "next/server";
import {
  createMembershipPlan,
  deleteMembershipPlan,
  listMembershipPlans,
  normalizeMembershipPlanInput,
  setMembershipPlanActive,
  updateMembershipPlan,
} from "@/lib/barber/memberships";
import { barberApiError, readJson, requireBarberApi } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * Catálogo de membresías que la barbería VENDE a sus clientes.
 * Los precios los define cada barbería aquí: nada hardcodeado en la UI.
 */
export async function GET(req: Request) {
  const g = await requireBarberApi({ permission: "memberships.manage", feature: "memberships" });
  if (!g.ok) return g.res;
  try {
    const url = new URL(req.url);
    const plans = await listMembershipPlans(g.ctx.barbershopId, {
      includeInactive: url.searchParams.get("all") === "1",
    });
    return NextResponse.json({ plans });
  } catch (err) {
    return barberApiError(err);
  }
}

export async function POST(req: Request) {
  const g = await requireBarberApi({ permission: "memberships.manage", feature: "memberships" });
  if (!g.ok) return g.res;
  try {
    const parsed = normalizeMembershipPlanInput(await readJson(req));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const id = await createMembershipPlan(g.ctx.barbershopId, parsed.value);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return barberApiError(err);
  }
}

export async function PATCH(req: Request) {
  const g = await requireBarberApi({ permission: "memberships.manage", feature: "memberships" });
  if (!g.ok) return g.res;
  try {
    const body = await readJson(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "Falta el id de la membresía." }, { status: 400 });

    // Alta/baja rápida desde la lista, sin abrir el formulario completo.
    if (typeof body.isActive === "boolean" && body.name === undefined) {
      await setMembershipPlanActive(g.ctx.barbershopId, id, body.isActive);
      return NextResponse.json({ ok: true });
    }

    const parsed = normalizeMembershipPlanInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    await updateMembershipPlan(g.ctx.barbershopId, id, parsed.value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return barberApiError(err);
  }
}

export async function DELETE(req: Request) {
  const g = await requireBarberApi({ permission: "memberships.manage", feature: "memberships" });
  if (!g.ok) return g.res;
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "Falta el id de la membresía." }, { status: 400 });
    await deleteMembershipPlan(g.ctx.barbershopId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return barberApiError(err);
  }
}
