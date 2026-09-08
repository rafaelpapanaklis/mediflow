import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { asignarEduCategoria } from "@/lib/edu/categorias";

export const dynamic = "force-dynamic";

/**
 * POST — CONECTA un procedimiento del catálogo a una categoría con llave.
 *
 * Es la escritura que cierra H-90, y vive aquí y no en la ruta de
 * procedimientos para no tocar archivos de otra casilla de esta ola. Solo
 * escribe `categoryId`; el `category` de texto libre se queda como estaba.
 *
 * `{ categoryId: null }` la desconecta.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("tarifarios.manage");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await asignarEduCategoria(g.ctx, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/categorias/asignar");
  }
}
