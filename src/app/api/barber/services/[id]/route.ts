import { NextResponse } from "next/server";
import { barberApiError } from "@/lib/barber/branches";
import { deleteService, updateService } from "@/lib/barber/services";
import { gateServices, readJson, revalidateShopWeb } from "../_gate";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/barber/services/[id] → edita nombre, descripción, duración,
 * precio, categoría y activo/retirado. Solo lo que viene en el body.
 * Un id de otra barbería responde 404 (igual que uno inexistente).
 *
 * Cambiar el precio NO toca las citas ya agendadas: conservan
 * `priceAtBooking`. La respuesta trae `previousPrice` cuando cambió, para
 * que la pantalla lo diga con el número viejo delante.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateServices();
  if ("response" in gate) return gate.response;
  try {
    const body = await readJson(req);
    const result = await updateService(gate.ctx, params.id, body);
    revalidateShopWeb(gate.ctx.barbershop.slug);
    return NextResponse.json(result);
  } catch (e) {
    return barberApiError(e, "services/[id]:PATCH");
  }
}

/**
 * DELETE /api/barber/services/[id] → borra de verdad SOLO si no tiene citas
 * ni ventas (409 si las tiene: hay que retirarlo, no borrarlo).
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateServices();
  if ("response" in gate) return gate.response;
  try {
    await deleteService(gate.ctx, params.id);
    revalidateShopWeb(gate.ctx.barbershop.slug);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return barberApiError(e, "services/[id]:DELETE");
  }
}
