import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { listMovements, registerStockMovement } from "@/lib/barber/inventory";

export const dynamic = "force-dynamic";

// GET /api/barber/products/[id]/movements?limit= → bitácora del producto
// (products.manage o inventory.manage).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "products");
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "50");
    const movements = await listMovements(ctx, params.id, { limit: Number.isFinite(limitRaw) ? limitRaw : 50 });
    return NextResponse.json({ movements }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}

// POST /api/barber/products/[id]/movements { type, qty, reason } → movimiento
// MANUAL (inventory.manage): IN/RETURN suman, OUT resta, ADJUST lleva el
// delta con signo. SALE no se registra a mano. Nunca deja stock negativo.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "products");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await registerStockMovement(ctx, params.id, {
      type: body.type,
      qty: body.qty,
      reason: body.reason,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
