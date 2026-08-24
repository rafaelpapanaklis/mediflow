import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { createProduct, listProducts, type ProductInput } from "@/lib/barber/inventory";

export const dynamic = "force-dynamic";

// GET /api/barber/products?forSale=1&includeInactive=1 → catálogo de la
// barbería en sesión. forSale = picker de la caja (solo activos; cash.view);
// sin forSale exige products.manage. Plan AVANZADO+ (feature products).
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "products");
    const sp = req.nextUrl.searchParams;
    const products = await listProducts(ctx, {
      forSale: sp.get("forSale") === "1",
      includeInactive: sp.get("includeInactive") === "1",
    });
    return NextResponse.json({ products }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}

// POST /api/barber/products → crea producto (products.manage). El stock
// inicial deja un movimiento IN "Stock inicial".
export async function POST(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "products");
    const body = (await req.json().catch(() => ({}))) as ProductInput;
    const product = await createProduct(ctx, body);
    return NextResponse.json(product, { status: 201 });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
