import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { getEduInstitucion, updateEduInstitucion } from "@/lib/edu/institucion";

export const dynamic = "force-dynamic";

/**
 * LOS DATOS DEL PROPIO INSTITUTO (H-150).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTE ENDPOINT ES TODO EL ARREGLO DE H-150, Y NO LLEVA NI UNA LÍNEA DE
 * SQL. Las columnas existen desde la Ola 0 y la Ola 1; lo que faltaba era
 * que alguien pudiera escribirlas: «en todo el vertical hay DOS escrituras
 * a EduInstitution y ninguna es del panel».
 *
 * 🔴 PERMISO: `sedes.manage`, que solo lleva DIRECCION. Ninguna key nueva,
 * y no es un apaño: `sedes.manage` ya es la configuración de la escuela, y
 * los datos del instituto son su cabecera.
 *
 * 🔴 NO ACEPTA UN institutionId POR PARÁMETRO. Solo se lee y se escribe el
 * de la SESIÓN. Un endpoint que aceptara cuál instituto editar sería,
 * literalmente, el botón de renombrar la escuela de otro.
 *
 * 🔴 LA ZONA HORARIA se valida contra `Intl`: guardar «America/Tijuna» por
 * un dedazo movería la agenda de toda la escuela sin decir nada.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * GET — los datos. Se abre con `inicio.view` (lo tienen los cuatro roles):
 * el nombre y la zona horaria de la escuela los pinta el panel entero, y
 * esconderlos detrás del permiso de escritura habría obligado a cada
 * pantalla a consultarlos por su cuenta.
 */
export async function GET() {
  const g = await eduApiGuard("inicio.view");
  if ("response" in g) return g.response;
  try {
    return NextResponse.json(await getEduInstitucion(g.ctx));
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/institucion");
  }
}

/** PATCH — corrige los datos. Campo ausente no se escribe. */
export async function PATCH(request: Request) {
  const g = await eduApiGuard("sedes.manage");
  if ("response" in g) return g.response;
  try {
    const body = await eduReadJson(request);
    const r = await updateEduInstitucion(g.ctx, body, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, institucion: r });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/institucion");
  }
}
