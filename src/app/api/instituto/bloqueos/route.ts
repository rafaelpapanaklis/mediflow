import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { createEduBloqueo, listEduBloqueos } from "@/lib/edu/agenda-bloqueos";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduWithCampus } from "@/lib/edu/campus-core";

export const dynamic = "force-dynamic";

/**
 * LOS BLOQUEOS DE AGENDA (H-19): festivo, puente, sillón en mantenimiento.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 PERMISOS: `agenda.view` para leer —cualquiera que abre la rejilla
 * tiene que ver POR QUÉ un hueco está cerrado— y `sillones.manage` para
 * crear. Ninguna key nueva: cerrar un día o sacar un sillón de servicio es
 * la misma familia que capturar el horario de un sillón, y
 * `sillones.manage` solo lo lleva DIRECCION, que es de quien es la
 * decisión de cerrar la escuela un martes.
 *
 * 🔴 EL ALCANCE ES EL DE LA SEDE: quien solo entra al campus norte no
 * cierra el sur, y un bloqueo de TODO el instituto solo lo pone quien
 * entra a todas.
 *
 * ⚠️ UN BLOQUEO NO CANCELA LAS CITAS QUE YA ESTÁN. Cierra el hueco para lo
 * que venga; lo agendado se reagenda a mano, con su aviso al paciente.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** GET ?desde&hasta[&campusId][&chairId] — los bloqueos que SOLAPAN el rango. */
export async function GET(request: Request) {
  const g = await eduApiGuard("agenda.view");
  if ("response" in g) return g.response;
  try {
    const p = new URL(request.url).searchParams;
    const rows = await listEduBloqueos(g.ctx, {
      desde: p.get("desde"),
      hasta: p.get("hasta"),
      campusId: p.get("campusId"),
      chairId: p.get("chairId"),
    });
    return NextResponse.json({ rows });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/bloqueos");
  }
}

/** POST — crea un bloqueo. */
export async function POST(request: Request) {
  const g = await eduApiGuard("sillones.manage");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    // 🔴 S-5 · EL ALCANCE DE SEDE, DE VERDAD. `createEduBloqueo` comprueba
    // `eduCampusCovers(ctx.campusIds, campusId)` desde el primer día, pero
    // aquí se le pasaba `g.ctx` CRUDO: `campusIds` es opcional en
    // `EduCampusAware`, llegaba `undefined`, y `eduCampusCovers(undefined,
    // x)` devuelve `true` siempre. El `if` no rechazaba nunca y compilaba
    // sin ruido. Es el mismo patrón que ya usan facturación y agenda.
    const cctx = eduWithCampus(g.ctx, await getEduCampusScope(g.ctx));
    const r = await createEduBloqueo(cctx, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/bloqueos");
  }
}
