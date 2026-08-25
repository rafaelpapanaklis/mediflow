import { NextResponse } from "next/server";
import {
  REALTY_DEFAULT_PAGE_SIZE,
  REALTY_PAGE_SIZES,
  REALTY_PROPERTY_SORTS,
  createRealtyProperty,
  listRealtyProperties,
  type RealtyPropertyFilters,
  type RealtyPropertySort,
} from "@/lib/realty/properties";
import {
  boolParam,
  enumParam,
  gateRealty,
  intParam,
  readJson,
  realtyApiError,
} from "./_helpers";

export const dynamic = "force-dynamic";

const KINDS = [
  "CASA",
  "DEPARTAMENTO",
  "TERRENO",
  "BODEGA",
  "LOCAL",
  "EDIFICIO",
  "OFICINA",
  "RANCHO",
] as const;
const OPERATIONS = ["VENTA", "RENTA", "AMBAS"] as const;
const STATUSES = ["DISPONIBLE", "APARTADO", "VENDIDO", "RENTADO"] as const;
const CURRENCIES = ["MXN", "USD"] as const;

/**
 * GET /api/realty/properties — la cartera, filtrada y paginada.
 *
 * 🔴 NO recibe accountId: sale del contexto de sesión. Todo lo que llega
 * por query se valida contra su lista antes de tocar Prisma — un valor
 * libre en un enum es un 500, y en un `where` mal armado, algo peor.
 */
export async function GET(req: Request) {
  const gate = await gateRealty("properties.view");
  if ("response" in gate) return gate.response;

  try {
    const url = new URL(req.url);
    const p = url.searchParams;
    const num = (key: string): number | null => {
      const raw = p.get(key);
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    const kind = enumParam(p.get("kind"), KINDS);
    const status = enumParam(p.get("status"), STATUSES);
    const rawSort = p.get("sort");

    const filters: RealtyPropertyFilters = {
      q: p.get("q") ?? "",
      kind: kind ? [kind] : undefined,
      operation: enumParam(p.get("operation"), OPERATIONS),
      status: status ? [status] : undefined,
      priceMin: num("priceMin"),
      priceMax: num("priceMax"),
      currency: enumParam(p.get("currency"), CURRENCIES),
      bedroomsMin: num("bedroomsMin"),
      bathroomsMin: num("bathroomsMin"),
      city: p.get("city"),
      colonia: p.get("colonia"),
      assignedUserId: p.get("assignedUserId"),
      hasTour: boolParam(p.get("hasTour")),
      hasExclusive: boolParam(p.get("hasExclusive")),
      isPublished: boolParam(p.get("isPublished")),
      sort: (REALTY_PROPERTY_SORTS as readonly string[]).includes(rawSort ?? "")
        ? (rawSort as RealtyPropertySort)
        : "recientes",
      page: intParam(p.get("page"), 1),
      // Solo los tres tamaños que la capa de datos reconoce: pedir 30
      // devolvía 24 sin decir nada, y el cliente creía que iba paginando
      // de 30 en 30.
      pageSize: REALTY_PAGE_SIZES.includes(
        Number(p.get("pageSize")) as (typeof REALTY_PAGE_SIZES)[number],
      )
        ? Number(p.get("pageSize"))
        : REALTY_DEFAULT_PAGE_SIZE,
    };

    const result = await listRealtyProperties(gate.ctx, filters);
    return NextResponse.json(result);
  } catch (e) {
    return realtyApiError("properties:GET", e);
  }
}

/**
 * POST /api/realty/properties — alta.
 *
 * Solo lo indispensable: el resto de la ficha se completa sección por
 * sección. Nace SIN publicar (isPublished lo pone la capa de datos en
 * false), con folio y slug ya asignados.
 */
export async function POST(req: Request) {
  const gate = await gateRealty("properties.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json(
        { error: "Ponle un título al inmueble.", field: "title" },
        { status: 400 },
      );
    }

    const created = await createRealtyProperty(gate.ctx, {
      title,
      kind: enumParam(body.kind, KINDS) ?? "CASA",
      operation: enumParam(body.operation, OPERATIONS) ?? "VENTA",
      price: typeof body.price === "number" && body.price >= 0 ? body.price : 0,
      currency: enumParam(body.currency, CURRENCIES) ?? "MXN",
      colonia: typeof body.colonia === "string" ? body.colonia : null,
      city: typeof body.city === "string" ? body.city : null,
    });

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (e) {
    return realtyApiError("properties:POST", e);
  }
}
