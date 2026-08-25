import { NextResponse } from "next/server";
import { barberApiError } from "@/lib/barber/branches";
import { createService, listServices } from "@/lib/barber/services";
import { gateServices, readJson, revalidateShopWeb } from "./_gate";

export const dynamic = "force-dynamic";

/** GET /api/barber/services → catálogo completo (activos y retirados) + categorías en uso. */
export async function GET() {
  const gate = await gateServices();
  if ("response" in gate) return gate.response;
  try {
    const catalog = await listServices(gate.ctx);
    return NextResponse.json(catalog, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return barberApiError(e, "services:GET");
  }
}

/**
 * POST /api/barber/services → crea un servicio. Precio en Decimal, duración
 * en minutos enteros; el barbershopId sale de la sesión.
 */
export async function POST(req: Request) {
  const gate = await gateServices();
  if ("response" in gate) return gate.response;
  try {
    const body = await readJson(req);
    const service = await createService(gate.ctx, body);
    revalidateShopWeb(gate.ctx.barbershop.slug);
    return NextResponse.json({ service }, { status: 201 });
  } catch (e) {
    return barberApiError(e, "services:POST");
  }
}
