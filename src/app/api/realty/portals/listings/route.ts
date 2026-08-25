import { NextResponse } from "next/server";
import { setPropertyDestination } from "@/lib/realty/portals";
import { readJson, requirePortalsAccess, serverError } from "@/app/api/realty/portals/_server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/realty/portals/listings
 * body: { propertyId, portal, selected: boolean }
 *
 * ELEGIR QUÉ INMUEBLE VA A QUÉ DESTINO. Aquí es donde muerde el cupo: si el
 * cliente pagó 10 anuncios en un portal y tiene 40 inmuebles, esto le deja
 * escoger CUÁLES 10 y le dice cuántos le quedan. Cuando se llena responde
 * 409 con el número exacto y qué hacer, no un "no se pudo".
 *
 * `selected: false` no borra la fila: la deja PAUSADA. Así se conserva el
 * historial de que estuvo publicada y por qué se bajó, y el lugar del cupo
 * queda libre.
 */
export async function POST(req: Request) {
  const guard = await requirePortalsAccess();
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await readJson(req);
    const propertyId = typeof body.propertyId === "string" ? body.propertyId.trim() : "";
    const portal = typeof body.portal === "string" ? body.portal.trim() : "";
    const selected = body.selected === true;

    if (!propertyId || !portal) {
      return NextResponse.json({ error: "Falta el inmueble o el destino." }, { status: 400 });
    }

    // El accountId sale de la sesión; setPropertyDestination además vuelve a
    // comprobar que el inmueble sea de esta cuenta antes de tocar nada.
    const result = await setPropertyDestination(guard.accountId, {
      propertyId,
      portal,
      selected,
    });

    if (!result.ok) {
      // 409 y no 400: no es que el cliente mandara algo mal, es que el
      // recurso (los anuncios contratados) está agotado.
      const status = result.slots?.full ? 409 : 400;
      return NextResponse.json({ error: result.error, slots: result.slots }, { status });
    }
    return NextResponse.json({ ok: true, slots: result.slots });
  } catch (err) {
    return serverError("POST listings", err);
  }
}
