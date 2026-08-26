import { NextResponse } from "next/server";
import { dropAdoption, setAdoption } from "@/lib/realty/mls";
import { gateMls, mlsApiError, mlsNotFound, readJson } from "../../_guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH — encender o apagar una ficha adoptada en mi web, o reordenarla.
 *
 * El `where` del update lleva SIEMPRE el accountId de la sesión, así que
 * el id de la adopción de otra cuenta afecta a cero filas y responde 404.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateMls("web.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const ok = await setAdoption(gate.ctx, params.id, {
      enLaWeb: typeof body.enLaWeb === "boolean" ? body.enLaWeb : undefined,
      orden: typeof body.orden === "number" ? body.orden : undefined,
    });
    if (!ok) return mlsNotFound();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mlsApiError("adopciones/[id]:PATCH", e);
  }
}

/**
 * DELETE — dejar de pintar una ficha ajena.
 *
 * Aquí sí se BORRA la fila, al revés que el listing (que se apaga). Una
 * adopción no tiene historial colgando: es una decisión de escaparate y
 * deshacerla no deja a nadie sin el papel de dónde salió su dinero.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateMls("web.edit");
  if ("response" in gate) return gate.response;

  try {
    const ok = await dropAdoption(gate.ctx, params.id);
    if (!ok) return mlsNotFound();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mlsApiError("adopciones/[id]:DELETE", e);
  }
}
