import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { cambiarEstadoEduQuote, getEduQuote, updateEduQuote } from "@/lib/edu/presupuestos";

export const dynamic = "force-dynamic";

/**
 * PATCH — cambia el estado del presupuesto a mano (rechazar, cancelar,
 * volver a borrador).
 *
 * 🔴 UN ACEPTADO NO SE DES-ACEPTA. Lo dice la tabla de transiciones y lo
 * repite el mensaje del 409: un presupuesto aceptado que se revierte
 * dejaría el cobro que generó colgando de una aceptación que ya no existe.
 * Lo que se cancela es el cobro, en caja.
 *
 * 🔴 Y NO HAY DELETE en esta ruta. Un presupuesto rechazado no se borra:
 * la propuesta existió.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.charge");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await cambiarEstadoEduQuote(g.ctx, params.id, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `PATCH /api/instituto/presupuestos/${params.id}`);
  }
}

/** GET — UN presupuesto, entero (partidas incluidas). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.view");
  if ("response" in g) return g.response;
  try {
    const row = await getEduQuote(g.ctx, params.id);
    if (!row) {
      return NextResponse.json({ error: "Ese presupuesto no existe." }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err) {
    return eduApiError(err, `GET /api/instituto/presupuestos/${params.id}`);
  }
}

/**
 * PUT — REESCRIBE las partidas, el descuento y la vigencia.
 *
 * 🔴 SOLO MIENTRAS ES BORRADOR (409 si no). Un PRESENTADO ya tiene su liga
 * en el WhatsApp del paciente y su texto canónico es lo que se hashea al
 * aceptar: cambiarle una partida por detrás haría que el paciente
 * aceptara un total distinto del que vio. Para corregir uno presentado se
 * le devuelve a borrador (PATCH) y se edita ahí.
 *
 * Verbo aparte del PATCH a propósito: ese ya significa "cambia el estado",
 * y dos operaciones distintas compartiendo verbo es cómo un cliente que
 * manda el cuerpo equivocado cancela un presupuesto sin querer.
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.charge");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await updateEduQuote(g.ctx, params.id, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `PUT /api/instituto/presupuestos/${params.id}`);
  }
}
