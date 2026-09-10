import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import {
  asignarEduCategoria,
  asignarEduCategoriaRequisito,
} from "@/lib/edu/categorias";

export const dynamic = "force-dynamic";

/**
 * POST — CONECTA un procedimiento del catálogo, o un REQUISITO del plan de
 * estudios, a una categoría con llave.
 *
 * Es la escritura que cierra H-90, y vive aquí y no en la ruta de
 * procedimientos para no tocar archivos de otra casilla de esta ola.
 *
 * `{ procedureId, categoryId }`   → empareja un procedimiento.
 * `{ requirementId, categoryId }` → empareja un requisito (Ola C·2).
 * `{ categoryId: null }` desconecta, en los dos casos.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 UNA SOLA RUTA PARA LOS DOS, Y EL PERMISO ES `tarifarios.manage` EN
 * LOS DOS. Emparejar un requisito NO es editar el plan de estudios: no
 * cambia qué exige ni a quién, solo dice CON QUÉ LLAVE se compara la misma
 * categoría que ya tenía escrita. Es la misma decisión de ordenar el
 * catálogo, y partirla en dos permisos dejaría media escuela emparejada.
 *
 * ⚠️ Lo que sí cambia el plan —el mínimo, el rango, versionar— sigue detrás
 * de `requisitos.manage`, en sus propias rutas.
 *
 * 🔴 EL CUERPO DECIDE, Y NO SE ACEPTAN LOS DOS. Un cuerpo con
 * `procedureId` Y `requirementId` es un cliente confundido: se rebota en
 * vez de elegir uno en silencio.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("tarifarios.manage");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const esRequisito = body?.requirementId !== undefined && body?.requirementId !== null;
    const esProcedimiento = body?.procedureId !== undefined && body?.procedureId !== null;

    if (esRequisito && esProcedimiento) {
      return NextResponse.json(
        {
          error:
            "Manda un procedimiento O un requisito, no los dos: son dos filas distintas y esta llamada solo empareja una.",
        },
        { status: 400 },
      );
    }

    const r = esRequisito
      ? await asignarEduCategoriaRequisito(g.ctx, body, eduAuditRequestMeta(request))
      : await asignarEduCategoria(g.ctx, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/categorias/asignar");
  }
}
