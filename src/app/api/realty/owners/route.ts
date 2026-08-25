import { NextResponse } from "next/server";
import { createRealtyOwner, listRealtyOwners } from "@/lib/realty/properties";
import {
  gateRealty,
  intParam,
  readJson,
  realtyApiError,
} from "../properties/_helpers";

export const dynamic = "force-dynamic";

/**
 * Propietarios — la libreta de DUEÑOS de la cartera.
 *
 * ⚠️ `requirePlanFeature: false` a propósito: en el contrato, el item
 * `propietarios` tiene featureKey NULL (no lo gatea el plan, solo el rol y
 * el modo de la cuenta). Si aquí exigiéramos la feature `properties`,
 * cerraríamos una pantalla que el sidebar SÍ enseña — y el usuario vería un
 * menú que lleva a un 403.
 */

/** GET /api/realty/owners?q=&page= */
export async function GET(req: Request) {
  const gate = await gateRealty("owners.manage", { requirePlanFeature: false });
  if ("response" in gate) return gate.response;

  try {
    const url = new URL(req.url);
    const result = await listRealtyOwners(gate.ctx, {
      q: url.searchParams.get("q") ?? "",
      page: intParam(url.searchParams.get("page"), 1),
      pageSize: intParam(url.searchParams.get("pageSize"), 25, 5, 100),
    });
    return NextResponse.json(result);
  } catch (e) {
    return realtyApiError("owners:GET", e);
  }
}

/** POST /api/realty/owners — alta (también la rápida, desde la ficha). */
export async function POST(req: Request) {
  const gate = await gateRealty("owners.manage", { requirePlanFeature: false });
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "El nombre no puede quedar vacío.", field: "name" },
        { status: 400 },
      );
    }

    const owner = await createRealtyOwner(gate.ctx, {
      name,
      phone: typeof body.phone === "string" ? body.phone : null,
      email: typeof body.email === "string" ? body.email : null,
      rfc: typeof body.rfc === "string" ? body.rfc : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    });

    return NextResponse.json({ owner }, { status: 201 });
  } catch (e) {
    return realtyApiError("owners:POST", e);
  }
}
