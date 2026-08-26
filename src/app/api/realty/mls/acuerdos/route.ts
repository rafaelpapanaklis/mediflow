import { NextResponse } from "next/server";
import { listAgreements, proposeAgreement } from "@/lib/realty/mls";
import {
  REALTY_MLS_AGREEMENT_STATUSES,
  type RealtyMlsAgreementStatus,
} from "@/components/realty/mls/mls-contract";
import { gateMls, mlsApiError, mlsBadRequest, mlsNotFound, readJson } from "../_guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — los acuerdos donde mi cuenta es una de las dos partes.
 *
 * El `where` del motor es un OR entre los dos papeles, así que un acuerdo
 * entre otras dos cuentas no aparece por más que se pida por id. `estado`
 * filtra, y se sanea contra el catálogo: nada llega crudo a Prisma.
 */
export async function GET(req: Request) {
  const gate = await gateMls("properties.view");
  if ("response" in gate) return gate.response;

  try {
    const raw = new URL(req.url).searchParams.getAll("estado");
    const estados = raw.filter((s): s is RealtyMlsAgreementStatus =>
      (REALTY_MLS_AGREEMENT_STATUSES as string[]).includes(s),
    );
    const acuerdos = await listAgreements(gate.ctx, estados.length > 0 ? estados : undefined);
    return NextResponse.json({ acuerdos });
  } catch (e) {
    return mlsApiError("acuerdos:GET", e);
  }
}

/**
 * POST — proponer colaboración sobre una ficha ajena.
 *
 * 🔴 Lo único que el navegador manda es el `listingId`. El accountId del
 * dueño NO viaja nunca: el servidor lo deriva de la ficha. Un id que no
 * viaja es un id que no se puede falsificar, y sin eso cualquiera podría
 * escribir un acuerdo a nombre de la inmobiliaria de al lado.
 *
 * `properties.view` y no `properties.edit`: proponer no toca mi cartera,
 * y quien busca inventario ajeno es normalmente el asesor que anda en la
 * calle, que es justo el que suele tener el permiso de solo lectura.
 */
export async function POST(req: Request) {
  const gate = await gateMls("properties.view");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const listingId = typeof body.listingId === "string" ? body.listingId : "";
    if (!listingId) return mlsBadRequest("Falta la ficha.", "MISSING_LISTING");

    const res = await proposeAgreement(gate.ctx, {
      listingId,
      agreedPct:
        body.agreedPct === undefined || body.agreedPct === null
          ? undefined
          : Number(body.agreedPct),
      message: typeof body.message === "string" ? body.message : undefined,
    });

    if (!res.ok) {
      switch (res.reason) {
        case "bad_pct":
          return mlsBadRequest("El porcentaje tiene que estar entre 0 y 100.", "BAD_PCT");
        case "no_collab":
          return mlsBadRequest(
            "Quien comparte este inmueble no está aceptando colaboraciones.",
            "NO_COLLAB",
          );
        case "already":
          return NextResponse.json(
            {
              error: "Ya tienes un acuerdo con esta ficha.",
              code: "ALREADY",
              agreementId: res.agreementId,
            },
            { status: 409 },
          );
        // "own" cae en el 404 genérico a propósito: quien prueba ids al azar
        // no tiene por qué enterarse de cuál es suyo y cuál no existe.
        default:
          return mlsNotFound();
      }
    }
    return NextResponse.json({ ok: true, agreementId: res.agreementId });
  } catch (e) {
    return mlsApiError("acuerdos:POST", e);
  }
}
