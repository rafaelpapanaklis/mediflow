import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { parseEduChargeFilters } from "@/lib/edu/dinero-core";
import { createEduCharge, listEduCharges } from "@/lib/edu/caja";

export const dynamic = "force-dynamic";

/** GET — los cobros del turno (o los que pidan los filtros). */
export async function GET(request: Request) {
  const g = await eduApiGuard("caja.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    const page = await listEduCharges(g.ctx, parseEduChargeFilters(params));
    return NextResponse.json(page);
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/caja/cobros");
  }
}

/**
 * POST — cobra.
 *
 * 🔴 EL PRECIO NO SE LEE DEL BODY. Cada línea con `procedureId` la cotiza
 * el servidor con la lista que le toca al paciente. Si el navegador manda
 * un `unitPriceCents` distinto, se descarta EN SILENCIO (el cobro sale con
 * el precio bueno) y el descartado queda guardado en la línea para poder
 * auditarlo. Sin esto, bastaría con abrir las herramientas del navegador
 * para pagar la tarifa de alumno siendo público general.
 *
 * `descartados` viaja en la respuesta para que la pantalla pueda avisar
 * cuando su caché de precios está vieja — no para acusar a nadie.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("caja.charge");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const canRefund = hasEduPermission(
      { role: g.ctx.role, permissionsOverride: g.ctx.user.permissionsOverride },
      "caja.refund",
    );
    const created = await createEduCharge(g.ctx, body, { canRefund });
    return NextResponse.json(
      { ok: true, id: created.id, folio: created.folio, descartados: created.descartados },
      { status: 201 },
    );
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/caja/cobros");
  }
}
