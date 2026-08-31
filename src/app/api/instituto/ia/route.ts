import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduIaPanel, updateEduAiQuota } from "@/lib/edu/ia-cupo";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/ia — el consumo de IA del mes, el cupo y las tarifas.
 *
 * 🔴 DOS CANDADOS, como en todo el vertical:
 *   1. el PERMISO "ia.view" abre la puerta;
 *   2. el ALCANCE del dinero (visibility.ts, recurso "charges") decide las
 *      filas — y para DOCENTE y ALUMNO ese alcance es "none" pase lo que
 *      pase. Encenderle "ia.view" a un alumno desde la pantalla de
 *      permisos le abre una pantalla vacía, no el gasto de la escuela.
 */
export async function GET() {
  const g = await eduApiGuard("ia.view");
  if ("response" in g) return g.response;

  try {
    const panel = await getEduIaPanel(g.ctx, g.ctx.institution.timezone, {
      puedeEditar: hasEduPermission(
        { role: g.ctx.role, permissionsOverride: g.ctx.user.permissionsOverride },
        "ia.manage",
      ),
    });
    return NextResponse.json(panel);
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/ia");
  }
}

/**
 * PATCH /api/instituto/ia — lo que la ESCUELA decide del cupo.
 *
 * Body: { isEnabled?, allowOverage?, hardCapUsdCents?, contactNote? }
 *
 * 🔴 LO QUE INCLUYE EL CONTRATO NO SE EDITA AQUÍ, y mandar
 * `monthlyUsdCents` devuelve 400 con el motivo escrito — no se ignora en
 * silencio. La cuenta de API que se consume es la de DaleControl: un
 * endpoint que dejara subir ese número convertiría "lo que incluye tu
 * contrato" en "lo que alguien tecleó". Ver src/lib/edu/ia-cupo.ts.
 *
 * 🔴 Y NO CREA la fila. Un instituto sin cupo asignado recibe 409: crearla
 * obligaría a elegir un cupo mensual, que es justo lo que el panel no
 * decide.
 *
 * Las validaciones viven en el SERVIDOR y no en el formulario: permitir
 * excedente exige tope, y el tope tiene que ser mayor que lo incluido. Una
 * validación que solo está en la pantalla no es una validación.
 */
export async function PATCH(request: Request) {
  const g = await eduApiGuard("ia.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const cupo = await updateEduAiQuota(g.ctx, body, g.ctx.institution.timezone);
    return NextResponse.json({ ok: true, cupo });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/ia");
  }
}
