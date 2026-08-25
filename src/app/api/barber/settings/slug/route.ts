import { NextResponse, type NextRequest } from "next/server";
import { barberApiError } from "@/lib/barber/branches";
import { changeBarberSlug, checkSlugAvailability } from "@/lib/barber/settings";
import { gateSettings, readJson, revalidateShopWeb } from "../_gate";

export const dynamic = "force-dynamic";

/**
 * GET /api/barber/settings/slug?slug=… → ¿está libre? Devuelve el slug ya
 * normalizado (lo que se guardaría) y el motivo si no sirve.
 */
export async function GET(req: NextRequest) {
  const gate = await gateSettings();
  if ("response" in gate) return gate.response;
  try {
    const check = await checkSlugAvailability(gate.ctx, req.nextUrl.searchParams.get("slug") ?? "");
    return NextResponse.json(check, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return barberApiError(e, "settings/slug:GET");
  }
}

/**
 * PATCH /api/barber/settings/slug — { slug, confirm: true }.
 *
 * Cambiar la dirección pública ROMPE las ligas ya compartidas y los QR
 * impresos. La pantalla lo avisa y exige marcar que se entiende; el servidor
 * vuelve a exigir `confirm` porque un botón no es un candado. Uno ocupado
 * responde 409. Se revalidan la página vieja y la nueva.
 */
export async function PATCH(req: Request) {
  const gate = await gateSettings();
  if ("response" in gate) return gate.response;
  try {
    const body = await readJson(req);
    const change = await changeBarberSlug(gate.ctx, body.slug, body.confirm);
    if (change.changed) {
      revalidateShopWeb(change.previous);
      revalidateShopWeb(change.slug);
    }
    return NextResponse.json(change);
  } catch (e) {
    return barberApiError(e, "settings/slug:PATCH");
  }
}
