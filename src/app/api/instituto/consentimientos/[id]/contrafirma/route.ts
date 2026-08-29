import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { countersignEduConsent } from "@/lib/edu/consentimientos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/consentimientos/[id]/contrafirma — la contrafirma
 * del profesional (NOM-013 9.6.9), que en una escuela son DOS.
 *
 * 🔴 EL HUECO LO DECIDE LA SESIÓN, NO EL CUERPO. El servidor compara el
 * eduUserId con las dos columnas de la carta y decide si esta persona
 * firma como el alumno que atiende o como el docente responsable. Si el
 * cuerpo pudiera elegirlo, cualquiera con `consentimientos.create` firmaría
 * como responsable de un acto que no supervisó — que es exactamente la
 * firma que un consentimiento existe para que no se pueda falsear.
 *
 * 🔴 No se contrafirma una carta que el paciente todavía no ha firmado.
 * Impide lo que de verdad pasa en una clínica con prisa: firmar de
 * antemano un fajo de cartas en blanco "para adelantar trámite".
 *
 * Permiso: `consentimientos.create`. Quien puede emitir una carta puede
 * contrafirmar la SUYA — y solo la suya, porque el hueco lo decide la
 * comparación de arriba, no el permiso.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("consentimientos.create");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const out = await countersignEduConsent(g.ctx, params.id, body);
    return NextResponse.json(out);
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/consentimientos/[id]/contrafirma");
  }
}
