import { NextResponse } from "next/server";
import { rateLimitKey } from "@/lib/rate-limit";
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
 * ⚠️ ESTA LLAMADA CUESTA DINERO. Lo que la protege, en orden de más barato
 * a más caro:
 *   1. el permiso `estudios.analyze` (default: ALUMNO, DOCENTE, DIRECCION;
 *      caja NO);
 *   2. el ALCANCE del expediente: un estudio de otro alumno no existe
 *      desde aquí (404, igual que uno que no existe);
 *   3. el formato y el tamaño, leídos de la fila (los midió Storage al
 *      confirmar la subida, no el cliente);
 *   4. un freno de 90 segundos contra el doble toque, que devuelve el
 *      análisis recién hecho en vez de pedir otro;
 *   5. y el CUPO DE IA del instituto (Ola 8): si se acabó, contesta 402
 *      diciendo cuánto se lleva consumido y a quién pedirle más; si falta
 *      configurarlo —sin cupo en el contrato, sin tarifa o sin llave—,
 *      contesta 503 con el motivo escrito para una persona.
 *
 * 🔴 EL CUPO VA DESPUÉS DEL FRENO DE DOBLE TOQUE, y ese orden importa: un
 * segundo toque devuelve la lectura recién hecha SIN gastar nada, así que
 * negárselo por cupo agotado sería negar algo que no cuesta.
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

  // ── 🔴 P2-12 · EL FRENO POR SESIÓN ───────────────────────────────────
  // El freno de 90 s del punto 4 es POR ESTUDIO: nada impedía recorrer N
  // estudios en bucle y comerse el cupo del instituto entero (que al
  // agotarse apaga la IA de TODA la escuela). Por eduUserId y no por IP —
  // la clínica entera sale por la misma IP. 5 por minuto: leer una placa
  // toma más de doce segundos a cualquier persona real; solo un bucle va
  // más rápido. Es el rateLimit en memoria del repo (por instancia); el
  // candado del dinero sigue siendo el cupo de la Ola 8.
  if (!rateLimitKey(`edu-ia-analisis:${g.ctx.eduUserId}`, 5)) {
    return NextResponse.json(
      { error: "Demasiados análisis seguidos. Espera un minuto y vuelve a intentar." },
      { status: 429 },
    );
  }

  try {
    const out = await analyzeEduStudy(g.ctx, params.id, g.ctx.institution.timezone);
    return NextResponse.json(out, { status: out.reutilizado ? 200 : 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/estudios/[id]/analisis");
  }
}
