import { NextResponse } from "next/server";
import { deleteBarberVisitPhoto, updateBarberVisitPhoto } from "@/lib/barber/clients";
import { alsoHas, gateBarberClients, readJson, serverError } from "../../../_helpers";

export const dynamic = "force-dynamic";

/**
 * PATCH { visibleToClient?, kind? }
 *
 * FRONTERA CON T5 (portal del cliente): esta bandera es la que decide qué ve
 * el cliente final. Cambiarla exige `portal.manage`, no basta con
 * `clients.edit` — publicar una foto es una acción distinta de guardarla.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; photoId: string } },
) {
  const gate = await gateBarberClients("clients.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    if (body.visibleToClient !== undefined && !alsoHas(gate.ctx, "portal.manage")) {
      return NextResponse.json(
        { error: "Necesitas permiso del portal del cliente para publicar fotos." },
        { status: 403 },
      );
    }

    const photo = await updateBarberVisitPhoto(
      gate.ctx,
      params.photoId,
      { visibleToClient: body.visibleToClient, kind: body.kind },
      params.id,
    );
    if (!photo) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ photo });
  } catch (e) {
    return serverError("photos.patch", e);
  }
}

/** DELETE — borra la fila Y el binario del bucket. */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; photoId: string } },
) {
  const gate = await gateBarberClients("clients.edit");
  if ("response" in gate) return gate.response;

  try {
    const ok = await deleteBarberVisitPhoto(gate.ctx, params.photoId, params.id);
    if (!ok) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError("photos.delete", e);
  }
}
