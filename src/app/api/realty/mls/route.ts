import { NextResponse } from "next/server";
import { searchBolsa } from "@/lib/realty/mls";
import {
  REALTY_MLS_KINDS,
  REALTY_MLS_MAX_PAGE_SIZE,
  REALTY_MLS_OPERATIONS,
  REALTY_MLS_PAGE_SIZE,
  REALTY_MLS_SORTS,
  type RealtyMlsFilters,
  type RealtyMlsSort,
} from "@/components/realty/mls/mls-contract";
import { enumParam, gateMls, intParam, mlsApiError, numParam } from "./_guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/realty/mls — buscar en la bolsa.
 *
 * Los mismos filtros del inventario propio más el que de verdad decide:
 * `comisionMin`. Todo lo que llega del navegador se sanea aquí —enums
 * contra su catálogo, números contra su rango, texto recortado— y nada
 * entra crudo a Prisma.
 *
 * El accountId NO viaja en el query. Sale de la sesión, dentro de
 * `searchBolsa`, y es el que decide qué es "mío" y qué es "ajeno".
 */
export async function GET(req: Request) {
  const gate = await gateMls("properties.view");
  if ("response" in gate) return gate.response;

  try {
    const url = new URL(req.url);
    const q = url.searchParams;

    const filters: RealtyMlsFilters = {
      q: (q.get("q") ?? "").trim().slice(0, 120) || undefined,
      kind: enumParam(q.get("kind"), REALTY_MLS_KINDS) ?? undefined,
      operation: enumParam(q.get("operation"), REALTY_MLS_OPERATIONS) ?? undefined,
      ciudad: (q.get("ciudad") ?? "").trim().slice(0, 80) || undefined,
      colonia: (q.get("colonia") ?? "").trim().slice(0, 80) || undefined,
      precioMin: numParam(q.get("precioMin")),
      precioMax: numParam(q.get("precioMax")),
      recamarasMin: numParam(q.get("recamarasMin")),
      comisionMin: numParam(q.get("comisionMin")),
      soloColaboracion: q.get("soloColaboracion") === "1",
      sort: (enumParam(q.get("sort"), REALTY_MLS_SORTS) ?? "recientes") as RealtyMlsSort,
      page: intParam(q.get("page"), 1, 1, 500),
      pageSize: intParam(q.get("pageSize"), REALTY_MLS_PAGE_SIZE, 1, REALTY_MLS_MAX_PAGE_SIZE),
    };

    const result = await searchBolsa(gate.ctx, filters);
    return NextResponse.json(result);
  } catch (e) {
    return mlsApiError("GET", e);
  }
}
