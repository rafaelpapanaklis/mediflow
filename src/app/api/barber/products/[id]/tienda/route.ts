import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import { assertBarberFeature } from "@/lib/barber/cash";
import { saveProductExtras, tiendaPanelError, type ProductExtrasInput } from "@/lib/barber/tienda";

export const dynamic = "force-dynamic";

// PATCH /api/barber/products/[id]/tienda → categoría, descripción corta,
// «Mostrar en mi página web» y «Se puede apartar en línea» (lo que llegue).
// products.manage + plan con productos. Un id de otra barbería → 404. Sin
// sql/barber_tienda.sql → 409 TIENDA_SQL_PENDING (la pantalla ni lo ofrece).
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "products");
    const body = (await req.json().catch(() => ({}))) as ProductExtrasInput;
    const extras = await saveProductExtras(ctx, params.id, body);
    return NextResponse.json(extras);
  } catch (e) {
    return tiendaPanelError(e);
  }
}
