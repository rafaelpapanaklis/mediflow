import { NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { listSaleDrafts, saveSaleDraft } from "@/lib/barber/sale-drafts";

export const dynamic = "force-dynamic";

// GET /api/barber/sales/drafts?clientId= → notas «Por cobrar» abiertas de la
// sede (cash.view). { ready:false } si falta sql/barber_por_cobrar.sql.
export async function GET(req: Request) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const clientId = new URL(req.url).searchParams.get("clientId");
    return NextResponse.json(await listSaleDrafts(ctx, { clientId }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}

// POST /api/barber/sales/drafts { id?, clientId?, payload } → guarda o edita
// una nota abierta (cash.manage). No toca el corte ni ingresos.
export async function POST(req: Request) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const saved = await saveSaleDraft(ctx, { id: body.id, clientId: body.clientId, payload: body.payload });
    return NextResponse.json(saved, { status: body.id ? 200 : 201 });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
