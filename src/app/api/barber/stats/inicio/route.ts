import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { assertBarberSubscriptionActive, barberGateErrorPayload } from "@/lib/barber/gating";
import { moneyErrorResponse } from "@/lib/barber/cash";
import { getInicioSummary } from "@/lib/barber/stats";

export const dynamic = "force-dynamic";

// GET /api/barber/stats/inicio?branchId=<id|all> → el resumen del día que
// pinta /barber/inicio. Todos los planes (es la pantalla de inicio); exige
// suscripción al día. El barbershopId sale de la sesión; `branchId` solo
// puede elegir entre las sedes que getAccessibleBranchIds ya autoriza (un id
// ajeno cae a la sede propia). Un rol BARBER recibe SOLO su producción y sus
// visitas: el recorte lo hace getInicioSummary en el servidor.
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberSubscriptionActive(ctx);
    const plan = await getBarberPlan(ctx.barbershop.plan);
    const summary = await getInicioSummary(ctx, {
      branchId: req.nextUrl.searchParams.get("branchId"),
      features: plan.features,
    });
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const gate = barberGateErrorPayload(e);
    if (gate) return NextResponse.json(gate.body, { status: gate.status });
    return moneyErrorResponse(e);
  }
}
