import { NextResponse } from "next/server";
import { setListingActive } from "@/lib/realty/mls";
import { gateMls, mlsApiError, mlsNotFound, readJson } from "../../_guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH — el interruptor de "compartir en la bolsa".
 *
 * `active: false` y la ficha desaparece de la bolsa de TODAS las cuentas
 * en la siguiente consulta. No hay copia, no hay caché que invalidar, no
 * hay trabajo diferido que pueda quedarse atrás: las lecturas de la bolsa
 * filtran por `active` en el mismo SELECT.
 *
 * El `where` del update lleva SIEMPRE el accountId de la sesión, así que
 * un listingId ajeno afecta a cero filas y responde 404.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateMls("properties.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const active = body.active !== false;
    const ok = await setListingActive(gate.ctx, params.id, active);
    if (!ok) return mlsNotFound();
    return NextResponse.json({ ok: true, active });
  } catch (e) {
    return mlsApiError("listings/[id]:PATCH", e);
  }
}

/**
 * DELETE — retirar de la bolsa.
 *
 * Apaga la fila en vez de borrarla, y es deliberado: los acuerdos de
 * colaboración cuelgan de este listingId. Borrarlo dejaría huérfano el
 * historial de un trato que quizá ya generó una comisión, y a las dos
 * partes sin el papel que explica de dónde salió su dinero.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateMls("properties.edit");
  if ("response" in gate) return gate.response;

  try {
    const ok = await setListingActive(gate.ctx, params.id, false);
    if (!ok) return mlsNotFound();
    return NextResponse.json({ ok: true, active: false });
  } catch (e) {
    return mlsApiError("listings/[id]:DELETE", e);
  }
}
