import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature, moneyErrorResponse } from "@/lib/barber/cash";
import { updateProduct, type ProductInput } from "@/lib/barber/inventory";

export const dynamic = "force-dynamic";

// PATCH /api/barber/products/[id] → edita nombre/SKU/precio/costo/mínimo/
// unidad/activo. El stock NO se edita aquí (solo por movimientos).
// products.manage. Un id de otra barbería responde 404.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "products");
    const body = (await req.json().catch(() => ({}))) as ProductInput;
    const product = await updateProduct(ctx, params.id, body);
    return NextResponse.json(product);
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
