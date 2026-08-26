import { NextResponse } from "next/server";
import {
  getListingForProperty,
  listMyShared,
  listShareableProperties,
  shareProperty,
} from "@/lib/realty/mls";
import { gateMls, mlsApiError, mlsBadRequest, mlsNotFound, readJson } from "../_guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — lo que YO comparto, con el pulso de cada ficha (cuántas cuentas la
 * pintan en su web, cuántas propusieron colaborar), más mi cartera para
 * poder elegir qué compartir.
 *
 * Con `?propertyId=` devuelve en cambio los términos de UN inmueble, que es
 * lo que necesita el interruptor de la ficha (`<CompartirEnLaBolsa/>`,
 * components/realty/mls/compartir-inmueble.tsx) para pintarse. Se resuelve
 * aquí y no en una ruta aparte para que la ficha de T1 dependa de UN solo
 * endpoint del vertical.
 *
 * Todo lo que devuelve es MÍO: aquí no cruza nada entre cuentas. El
 * `propertyId` se comprueba contra mi cuenta dentro del motor
 * (`assertOwnProperty`) antes de leer nada.
 */
export async function GET(req: Request) {
  const gate = await gateMls("properties.view");
  if ("response" in gate) return gate.response;
  try {
    const propertyId = (new URL(req.url).searchParams.get("propertyId") ?? "").trim();
    if (propertyId) {
      // null significa las dos cosas a la vez —"no es tuyo" y "todavía no lo
      // compartes"— y está bien: el inmueble es de mi cuenta o no existe
      // para mí, así que no hay nada que un id ajeno pueda averiguar aquí.
      const listing = await getListingForProperty(gate.ctx, propertyId);
      return NextResponse.json({ listing });
    }

    const [compartidos, cartera] = await Promise.all([
      listMyShared(gate.ctx),
      listShareableProperties(gate.ctx),
    ]);
    return NextResponse.json({ compartidos, cartera });
  } catch (e) {
    return mlsApiError("listings:GET", e);
  }
}

/**
 * POST — compartir un inmueble propio en la bolsa, o cambiar sus términos.
 *
 * Es un upsert por inmueble: mandar esto dos veces no crea dos fichas. El
 * `propertyId` llega del navegador y NO se le cree nada hasta que la base
 * confirma que ese inmueble es de esta cuenta (`assertOwnProperty` dentro
 * de `shareProperty`).
 *
 * `exposedFields` se sanea contra la lista blanca: lo que no esté en ella
 * se descarta en silencio. Sin error, a propósito — un error diría "esa
 * llave existe pero no te la doy", que es justo lo que no queremos
 * contarle a quien esté probando nombres de columna.
 */
export async function POST(req: Request) {
  const gate = await gateMls("properties.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const propertyId = typeof body.propertyId === "string" ? body.propertyId : "";
    if (!propertyId) return mlsBadRequest("Falta el inmueble.", "MISSING_PROPERTY");

    const res = await shareProperty(gate.ctx, {
      propertyId,
      sharedCommissionPct: Number(body.sharedCommissionPct ?? 0),
      acceptsCollaboration: body.acceptsCollaboration !== false,
      requiresBuyerFromPartner: body.requiresBuyerFromPartner === true,
      exposedFields: Array.isArray(body.exposedFields)
        ? (body.exposedFields as string[])
        : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    });

    if (!res.ok) {
      if (res.reason === "bad_pct") {
        return mlsBadRequest(
          "El porcentaje que compartes tiene que estar entre 0 y 100.",
          "BAD_PCT",
        );
      }
      return mlsNotFound();
    }
    return NextResponse.json({ ok: true, listingId: res.listingId });
  } catch (e) {
    return mlsApiError("listings:POST", e);
  }
}
