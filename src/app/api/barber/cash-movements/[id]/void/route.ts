import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { voidCashMovement } from "@/lib/barber/caja-movimientos";

export const dynamic = "force-dynamic";

// POST /api/barber/cash-movements/[id]/void { reason? } → anula (nunca borra)
// un movimiento de la sede en sesión. Misma llave que registrarlo. Solo con
// su caja abierta; uno de otra barbería → 404.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const movement = await voidCashMovement(ctx, params.id, { reason: body?.reason });
    return NextResponse.json({ movement });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
