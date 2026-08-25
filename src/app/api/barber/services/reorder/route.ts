import { NextResponse } from "next/server";
import { barberApiError } from "@/lib/barber/branches";
import { reorderServices } from "@/lib/barber/services";
import { gateServices, readJson, revalidateShopWeb } from "../_gate";

export const dynamic = "force-dynamic";

/**
 * POST /api/barber/services/reorder — { ids: string[] } en el orden nuevo.
 * sortOrder es uno solo: vale para la agenda, la reserva, la mini-web y la
 * caja. Devuelve el catálogo ya reordenado.
 */
export async function POST(req: Request) {
  const gate = await gateServices();
  if ("response" in gate) return gate.response;
  try {
    const body = await readJson(req);
    const catalog = await reorderServices(gate.ctx, body.ids);
    revalidateShopWeb(gate.ctx.barbershop.slug);
    return NextResponse.json(catalog);
  } catch (e) {
    return barberApiError(e, "services/reorder:POST");
  }
}
