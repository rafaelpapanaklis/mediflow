import { NextResponse } from "next/server";
import {
  deleteRealtyOwner,
  getRealtyOwner,
  updateRealtyOwner,
} from "@/lib/realty/properties";
import { gateRealty, readJson, realtyApiError } from "../../properties/_helpers";

export const dynamic = "force-dynamic";

function ownerNotFound() {
  return NextResponse.json({ error: "Ese propietario ya no existe." }, { status: 404 });
}

/** GET — la ficha del propietario con sus inmuebles y sus exclusivas. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("owners.manage", { requirePlanFeature: false });
  if ("response" in gate) return gate.response;
  try {
    const owner = await getRealtyOwner(gate.ctx, params.id);
    if (!owner) return ownerNotFound();
    return NextResponse.json({ owner });
  } catch (e) {
    return realtyApiError("owners/[id]:GET", e);
  }
}

/** PATCH — editar sus datos de contacto. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("owners.manage", { requirePlanFeature: false });
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return NextResponse.json(
          { error: "El nombre no puede quedar vacío.", field: "name" },
          { status: 400 },
        );
      }
    }

    const ok = await updateRealtyOwner(gate.ctx, params.id, {
      name: typeof body.name === "string" ? body.name : undefined,
      phone: "phone" in body ? (typeof body.phone === "string" ? body.phone : null) : undefined,
      email: "email" in body ? (typeof body.email === "string" ? body.email : null) : undefined,
      rfc: "rfc" in body ? (typeof body.rfc === "string" ? body.rfc : null) : undefined,
      notes: "notes" in body ? (typeof body.notes === "string" ? body.notes : null) : undefined,
    });
    if (!ok) return ownerNotFound();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return realtyApiError("owners/[id]:PATCH", e);
  }
}

/**
 * DELETE — borrar al propietario.
 *
 * 🔴 RealtyProperty.owner tiene onDelete: NoAction a propósito (con SetNull,
 * borrar al dueño dejaba sus inmuebles con ownerId NULL, indistinguibles de
 * los que nunca tuvieron uno). Así que con inmuebles a su nombre el delete
 * TRUENA en la base con una violación de llave foránea. Se comprueba antes
 * para contestar algo que se entienda en vez de un 500.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("owners.manage", { requirePlanFeature: false });
  if ("response" in gate) return gate.response;

  try {
    const result = await deleteRealtyOwner(gate.ctx, params.id);
    if (result.ok) return NextResponse.json({ ok: true });

    if (result.reason === "has_properties") {
      return NextResponse.json(
        {
          error: "No se puede eliminar: todavía tiene inmuebles a su nombre.",
          code: "HAS_PROPERTIES",
        },
        { status: 409 },
      );
    }
    if (result.reason === "has_exclusives") {
      return NextResponse.json(
        {
          error: "No se puede eliminar: todavía tiene exclusivas firmadas.",
          code: "HAS_EXCLUSIVES",
        },
        { status: 409 },
      );
    }
    return ownerNotFound();
  } catch (e) {
    return realtyApiError("owners/[id]:DELETE", e);
  }
}
