// Ortodoncia — la guarda de los PDF del caso que se piden por dirección (ws1-t12, revisión final).
//
// El PDF del plan, el de antes/después y la carta de avance llamaban a su acción y devolvían 400 «Sin permisos:
// medicalRecord.view» a quien no tenía la llave; el expediente y la carta de alta ya contestaban 403 con un mensaje
// claro. Esta guarda es esa misma revisión, en un solo lugar: sesión (401), clínica dental, módulo activo, acceso al
// módulo y permiso de ver el expediente (403, con el mensaje que se le puede leer a la persona).

import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { MENSAJE_SIN_ACCESO_ORTODONCIA, tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import { MENSAJE_SIN_PERMISO_DE_EXPEDIENTE, puedeVerExpediente } from "@/lib/orthodontics/permiso-expediente";

/** `null` = puede seguir; si no, la respuesta que se devuelve tal cual. */
export async function guardaDelPdfDelCaso(): Promise<NextResponse | null> {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  if (ctx.clinicCategory !== "DENTAL") return NextResponse.json({ ok: false, error: "Categoría no válida" }, { status: 403 });
  if (!(await hasActiveOrthodonticsModule(ctx.clinicId))) return NextResponse.json({ ok: false, error: "Módulo no activo" }, { status: 403 });
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) {
    return NextResponse.json({ ok: false, error: MENSAJE_SIN_ACCESO_ORTODONCIA }, { status: 403 });
  }
  if (!puedeVerExpediente(ctx)) return NextResponse.json({ ok: false, error: MENSAJE_SIN_PERMISO_DE_EXPEDIENTE }, { status: 403 });
  return null;
}

/** Lo que falló DESPUÉS de la guarda: lo que no existe (o no se puede ver) es 404; el resto, 400. */
export function estadoDeFalloDelPdf(mensaje: string): 400 | 404 {
  return /no encontrad/i.test(mensaje) ? 404 : 400;
}
