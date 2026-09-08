import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { createEduCategoria, listEduCategorias } from "@/lib/edu/categorias";

export const dynamic = "force-dynamic";

/**
 * LA CATEGORÍA DE PROCEDIMIENTO COMO ENTIDAD (H-90).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 PERMISOS: `tarifarios.view` / `tarifarios.manage`. Ninguna key nueva:
 * la categoría ES del catálogo de procedimientos, que ya vive detrás de
 * esas dos.
 *
 * 🔴 NO MIGRA NADA SOLO. `EduProcedure.category` (texto libre) se queda
 * intacta; el GET devuelve además `sinPareja`, que son los textos libres
 * que todavía no tienen llave, para que una PERSONA los empareje.
 * Emparejar «Endodoncia», «endodoncias» y «ENDO» es un juicio humano, y
 * una migración automática que se equivoque pone el avance de una
 * generación a cero en silencio — que es exactamente el fallo H-90.
 *
 * ⚠️ La ruta cuelga de `/api/instituto/categorias` y no de
 * `/api/instituto/procedimientos/...` a propósito: los procedimientos son
 * de otra casilla de esta ola y esto no toca ni uno de sus archivos.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** GET — las categorías, con cuántos procedimientos cuelgan de cada una. */
export async function GET() {
  const g = await eduApiGuard("tarifarios.view");
  if ("response" in g) return g.response;
  try {
    return NextResponse.json(await listEduCategorias(g.ctx));
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/categorias");
  }
}

/** POST — da de alta una categoría. La clave se deriva del nombre. */
export async function POST(request: Request) {
  const g = await eduApiGuard("tarifarios.manage");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await createEduCategoria(g.ctx, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/categorias");
  }
}
