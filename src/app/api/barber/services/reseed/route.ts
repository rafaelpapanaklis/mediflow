import { NextResponse } from "next/server";
import { barberApiError } from "@/lib/barber/branches";
import { reseedDefaultServices } from "@/lib/barber/services";
import { gateServices, revalidateShopWeb } from "../_gate";

export const dynamic = "force-dynamic";

/**
 * POST /api/barber/services/reseed → vuelve a cargar los 9 servicios
 * sugeridos (BARBER_DEFAULT_SERVICES). SOLO con el catálogo vacío; si ya hay
 * servicios (activos o retirados) responde 409.
 */
export async function POST() {
  const gate = await gateServices();
  if ("response" in gate) return gate.response;
  try {
    const catalog = await reseedDefaultServices(gate.ctx);
    revalidateShopWeb(gate.ctx.barbershop.slug);
    return NextResponse.json(catalog, { status: 201 });
  } catch (e) {
    return barberApiError(e, "services/reseed:POST");
  }
}
