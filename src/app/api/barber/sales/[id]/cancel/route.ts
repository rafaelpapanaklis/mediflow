import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, cancelSale, moneyErrorResponse } from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// POST /api/barber/sales/[id]/cancel { reason } → cancela el ticket: ceros,
// stock devuelto (RETURN), comisión borrada, canjes restituidos. Solo con el
// turno aún abierto y la comisión sin pagar. cash.manage.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sale = await cancelSale(ctx, params.id, { reason: body.reason });
    return NextResponse.json(sale);
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
