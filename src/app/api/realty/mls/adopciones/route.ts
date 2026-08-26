import { NextResponse } from "next/server";
import { REALTY_MLS_MAX_ADOPTIONS, adoptListing, listAdoptions } from "@/lib/realty/mls";
import { gateMls, mlsApiError, mlsBadRequest, mlsNotFound, readJson } from "../_guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — las fichas ajenas que estoy pintando en MI mini-web. */
export async function GET() {
  const gate = await gateMls("properties.view");
  if ("response" in gate) return gate.response;
  try {
    const adopciones = await listAdoptions(gate.ctx);
    return NextResponse.json({ adopciones, tope: REALTY_MLS_MAX_ADOPTIONS });
  } catch (e) {
    return mlsApiError("adopciones:GET", e);
  }
}

/**
 * POST — adoptar una ficha ajena para pintarla en mi web.
 *
 * Adoptar NO es un acuerdo: es escaparate, y por eso no exige que el dueño
 * acepte colaboraciones. Lo que SÍ exige —y lo comprueba el motor— es que
 * el dueño tenga el inmueble PUBLICADO: si él lo tiene despublicado es
 * porque no quiere verlo anunciado, y prestarle mi web para saltarse eso
 * sería pasar por encima de su decisión.
 *
 * `web.edit` y no `properties.edit`: esto no toca mi cartera, cambia lo
 * que se ve en mi sitio.
 */
export async function POST(req: Request) {
  const gate = await gateMls("web.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const listingId = typeof body.listingId === "string" ? body.listingId : "";
    if (!listingId) return mlsBadRequest("Falta la ficha.", "MISSING_LISTING");

    const res = await adoptListing(gate.ctx, listingId);
    if (!res.ok) {
      switch (res.reason) {
        case "not_published":
          return mlsBadRequest(
            "Quien tiene este inmueble no lo tiene publicado, así que no se puede " +
              "poner en tu web.",
            "NOT_PUBLISHED",
          );
        case "limit":
          return mlsBadRequest(
            `Ya tienes ${REALTY_MLS_MAX_ADOPTIONS} inmuebles en colaboración en tu web. ` +
              "Quita alguno para agregar otro.",
            "LIMIT",
          );
        default:
          return mlsNotFound();
      }
    }
    return NextResponse.json({ ok: true, adoptionId: res.adoptionId });
  } catch (e) {
    return mlsApiError("adopciones:POST", e);
  }
}
