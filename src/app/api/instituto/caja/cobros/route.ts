import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { parseEduChargeFilters } from "@/lib/edu/dinero-core";
import { createEduCharge, listEduCharges } from "@/lib/edu/caja";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduCampusForCharge, eduWithCampus } from "@/lib/edu/campus-core";
import { EduPadronError } from "@/lib/edu/padron";

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
    const cctx = eduWithCampus(g.ctx, await getEduCampusScope(g.ctx));
    const page = await listEduCharges(cctx, parseEduChargeFilters(params));
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
    // 🔴 Ola 11 · EN QUÉ SEDE SE ESTÁ COBRANDO. Sale del selector de la
    // barra superior, JAMÁS del body: un campusId del navegador apuntaría
    // el cobro a la sede que quisiera y descuadraría el reporte de las dos.
    //
    // Con la vista consolidada puesta y varias sedes NO se puede cobrar, y
    // no es un capricho: cobrar ocurre en UN mostrador, y "todas" no es un
    // lugar. El mensaje dice dónde está el selector.
    const sede = await getEduCampusScope(g.ctx);
    const donde = eduCampusForCharge(sede);
    if (!donde.ok) {
      throw new EduPadronError(donde.reason ?? "Elige la sede en la que estás cobrando.", 400);
    }

    const created = await createEduCharge(eduWithCampus(g.ctx, sede), body, {
      canRefund,
      campusId: donde.campusId,
    });
    // P2-10: `duplicado` = este POST traía una clave de idempotencia ya
    // usada y se devolvió el cobro que YA existía — 200 y no 201, porque no
    // se creó nada. El folio es el del cobro original, que es lo que la
    // pantalla debe enseñar.
    return NextResponse.json(
      {
        ok: true,
        id: created.id,
        folio: created.folio,
        descartados: created.descartados,
        duplicado: created.duplicado,
      },
      { status: created.duplicado ? 200 : 201 },
    );
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/caja/cobros");
  }
}
