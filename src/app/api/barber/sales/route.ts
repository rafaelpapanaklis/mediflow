import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import {
  assertBarberFeature,
  createSale,
  listSales,
  moneyErrorResponse,
  type CreateSaleInput,
} from "@/lib/barber/cash";

export const dynamic = "force-dynamic";

// GET /api/barber/sales?sessionId=&limit= → tickets de la barbería (cash.view).
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const sp = req.nextUrl.searchParams;
    const limitRaw = Number(sp.get("limit") ?? "50");
    const rows = await listSales(ctx, {
      sessionId: sp.get("sessionId"),
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    });
    return NextResponse.json({ sales: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}

// POST /api/barber/sales → cobra un ticket (cash.manage, turno abierto).
// Body: { appointmentId?, clientId?, barberId?, items: [{kind, id, qty}],
//         discount?, tip?, paymentMethod, redeemLoyaltyItemIndex?,
//         membershipItemIndex?, notes? }. Los precios NO viajan en el body.
export async function POST(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const features = await assertBarberFeature(ctx, "cash");
    const body = (await req.json().catch(() => ({}))) as CreateSaleInput;
    const sale = await createSale(ctx, body, features);
    return NextResponse.json(sale, { status: 201 });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
