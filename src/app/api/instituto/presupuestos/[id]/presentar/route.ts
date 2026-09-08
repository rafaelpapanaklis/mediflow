import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { presentarEduQuote } from "@/lib/edu/presupuestos";

export const dynamic = "force-dynamic";

/**
 * POST — PRESENTA el presupuesto: le pone su token público y su vigencia.
 *
 * 🔴 EL TOKEN SE GENERA UNA VEZ Y NO SE REGENERA al volver a presentar.
 * Regenerarlo dejaría muerto el enlace que el paciente ya tiene en su
 * WhatsApp, y ése es exactamente el enlace por el que va a aceptar.
 *
 * 🔴 32 BYTES DE `randomBytes`, no un cuid: al otro lado del enlace no hay
 * sesión, y el token es lo ÚNICO que protege el presupuesto.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.charge");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await presentarEduQuote(g.ctx, params.id, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `POST /api/instituto/presupuestos/${params.id}/presentar`);
  }
}
