import { NextResponse } from "next/server";
import { deleteRealtyExclusive, saveRealtyExclusive } from "@/lib/realty/properties";
import { gateRealty, notFound, readJson, realtyApiError } from "../../_helpers";

export const dynamic = "force-dynamic";

/**
 * PUT — alta o edición de la exclusiva del inmueble.
 *
 * Es el papel que da derecho a cobrar comisión, así que va tras
 * `owners.manage` y no tras `properties.edit`: un asesor que captura fichas
 * no necesariamente es quien pacta condiciones con el dueño.
 *
 * Se guarda UNA por inmueble (la vigente). Si ya hay, se actualiza.
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("owners.manage");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
    const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
    const endsAt = typeof body.endsAt === "string" ? body.endsAt : "";
    const commissionPct = Number(body.commissionPct);

    const result = await saveRealtyExclusive(gate.ctx, params.id, {
      ownerId,
      startsAt,
      endsAt,
      commissionPct: Number.isFinite(commissionPct) ? commissionPct : 0,
    });

    if (!result.ok) {
      if (result.reason === "not_found") return notFound();
      if (result.reason === "bad_owner") {
        return NextResponse.json(
          { error: "Elige un propietario de tu libreta." },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: "La fecha de vencimiento tiene que ser posterior a la de inicio." },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return realtyApiError("properties/[id]/exclusive:PUT", e);
  }
}

/** DELETE — quitar la exclusiva del inmueble. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("owners.manage");
  if ("response" in gate) return gate.response;

  try {
    const ok = await deleteRealtyExclusive(gate.ctx, params.id);
    if (!ok) return notFound();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return realtyApiError("properties/[id]/exclusive:DELETE", e);
  }
}
