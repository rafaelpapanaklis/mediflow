import { NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, getSaleDetail, moneyErrorResponse } from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// GET /api/barber/sales/[id] → detalle del ticket (para imprimir/compartir).
// Solo tickets de la barbería en sesión: uno ajeno responde 404. cash.view.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const sale = await getSaleDetail(ctx, params.id);
    if (!sale) return NextResponse.json({ error: "Ticket no encontrado", code: "SALE_NOT_FOUND" }, { status: 404 });
    return NextResponse.json(sale, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
