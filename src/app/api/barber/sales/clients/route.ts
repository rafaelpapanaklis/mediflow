import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, lookupClients, moneyErrorResponse } from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// GET /api/barber/sales/clients?q= → búsqueda corta de clientes para el
// ticket (nombre o teléfono), con sellos de lealtad y membresía activa.
// Solo clientes de la barbería en sesión. cash.view.
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const clients = await lookupClients(ctx, q);
    return NextResponse.json({ clients }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
