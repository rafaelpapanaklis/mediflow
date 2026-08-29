import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { analyzeEduStudy, listEduStudyAnalyses } from "@/lib/edu/ia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/instituto/estudios/[id]/analisis — los análisis que ya tiene
 * esta imagen, del más nuevo al más viejo.
 *
 * 🔴 Se devuelven TODOS y no solo el último. El dental guarda UNO por
 * archivo (`XrayAnalysis.fileId @unique`, upsert) y re-analizar pisa el
 * anterior; en un consultorio está bien, porque hay un doctor y le importa
 * la última lectura. En una escuela no: el docente tiene que poder ver
 * EXACTAMENTE lo que su alumno vio cuando decidió, no la versión que lo
 * reemplazó después.
 *
 * Cuelga de /estudios/[id] y no de /pacientes/[id]/… porque Next no admite
 * dos segmentos dinámicos con nombres distintos al mismo nivel, y esa rama
 * ya usa [id] para el paciente.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.view");
  if ("response" in g) return g.response;

  try {
    const rows = await listEduStudyAnalyses(g.ctx, params.id, g.ctx.institution.timezone);
    return NextResponse.json({ rows });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/estudios/[id]/analisis");
  }
}

/**
 * POST /api/instituto/estudios/[id]/analisis — pide una lectura nueva.
 *
 * ⚠️ ESTA LLAMADA CUESTA DINERO. Lo que la protege, en orden:
 *   1. el permiso `estudios.analyze` (default: ALUMNO, DOCENTE, DIRECCION;
 *      caja NO);
 *   2. la bandera EDU_IA_ENABLED — apagada, contesta 503 explicando que
 *      falta conectar el cobro de IA del instituto;
 *   3. el ALCANCE del expediente: un estudio de otro alumno no existe
 *      desde aquí (404, igual que uno que no existe);
 *   4. el formato y el tamaño, leídos de la fila (los midió Storage al
 *      confirmar la subida, no el cliente);
 *   5. un freno de 90 segundos contra el doble toque, que devuelve el
 *      análisis recién hecho en vez de pedir otro.
 *
 * 🔴 EL RESULTADO NO ENTRA EN NINGUNA NOTA. Se guarda en su propia tabla y
 * la pantalla lo pinta aparte, con el aviso de que es APOYO y no
 * diagnóstico. Si el alumno quiere usar algo, lo escribe él en su nota —
 * con su nombre encima. Mismo criterio que el aiAssist del dental, que no
 * toca el S/O/A/P.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("estudios.analyze");
  if ("response" in g) return g.response;

  try {
    const out = await analyzeEduStudy(g.ctx, params.id, g.ctx.institution.timezone);
    return NextResponse.json(out, { status: out.reutilizado ? 200 : 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/estudios/[id]/analisis");
  }
}
