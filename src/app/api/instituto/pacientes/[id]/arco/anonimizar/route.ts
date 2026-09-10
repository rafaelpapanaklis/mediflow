import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { anonymizeEduPatient } from "@/lib/edu/arco";

export const dynamic = "force-dynamic";

/**
 * POST — ANONIMIZA la ficha: sustituye el PII y CONSERVA lo clínico.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTE ENDPOINT ES IRREVERSIBLE, Y POR ESO ESTÁ APARTE.
 *
 * Podría haber sido un `PATCH /arco` con un campo `accion`. No lo es: un
 * endpoint que borra datos personales para siempre no comparte URL con
 * uno que se deshace con otro clic. La ruta propia es lo que hace que
 * «anonimizar» no se pueda disparar por un cuerpo mal armado de la
 * pantalla de baja.
 *
 * La capa de datos exige ADEMÁS que la ficha esté YA dada de baja: la baja
 * se deshace, esto no, y obligar a pasar por ella convierte un clic de más
 * en la única marcha atrás que este flujo tiene.
 *
 * 🔴 LA BITÁCORA NO GUARDA EL PII QUE SE BORRÓ — solo QUÉ campos se
 * sustituyeron. Guardar el "antes" sería mover el dato personal a una
 * tabla de la que la anonimización no lo puede sacar.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("pacientes.view");
  if ("response" in g) return g.response;
  try {
    const r = await anonymizeEduPatient(g.ctx, params.id, eduAuditRequestMeta(request));
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return eduApiError(err, `POST /api/instituto/pacientes/${params.id}/arco/anonimizar`);
  }
}
