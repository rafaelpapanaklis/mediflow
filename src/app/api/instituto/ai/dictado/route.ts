import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { transcribeEduDictado } from "@/lib/edu/ia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/instituto/ai/dictado — audio → texto para la nota clínica.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ EXISTE ESTE ENDPOINT Y NO SE LLAMA AL DEL DENTAL
 *
 * /api/ai/transcribe se autentica con `getAuthContext()`, que exige una
 * fila `User` de clínica, y cobra con `addAiTokens(ctx.clinicId, …)`
 * contra `Clinic.aiTokensLimit`. Un usuario de instituto no tiene ninguna
 * de las dos cosas: llamarlo con una sesión de instituto devuelve 401.
 *
 * Lo que SÍ se reusa es la lógica, porque estaba separada: `transcribeAudio`
 * (src/lib/integrations/whisper.ts) es un envoltorio puro sobre la API de
 * OpenAI, sin sesión y sin cobro. Este handler le pone la puerta del
 * vertical delante y NO toca una línea del dental.
 *
 * ⚠️ Y la bandera: mientras EDU_IA_ENABLED esté apagada esto contesta 503
 * con el motivo escrito para una persona (ver src/lib/edu/ia-core.ts). Es
 * a propósito — la función está hecha, pero el gasto de IA del instituto
 * todavía no tiene a quién cargarse.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 🔴 EL PERMISO ES "expediente.write", no uno nuevo. Dictar es escribir la
 * nota: el micrófono es una forma de teclear. Un permiso propio sería un
 * interruptor que no cierra ninguna puerta —quien lo tenga apagado escribe
 * exactamente la misma nota a mano— y en este vertical el catálogo no
 * admite interruptores que no cierren nada.
 *
 * 🔴 EL AUDIO NO SE GUARDA. Entra, se transcribe y se descarta: no toca
 * Storage y no queda en ninguna fila. Un archivo con la voz de un paciente
 * contando su motivo de consulta es un dato sensible que nadie pidió
 * conservar.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("expediente.write");
  if ("response" in g) return g.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Se esperaba multipart/form-data." }, { status: 400 });
  }

  const audio = formData.get("audio");
  if (!audio || typeof audio === "string") {
    return NextResponse.json({ error: 'Falta el campo "audio".' }, { status: 400 });
  }

  try {
    const out = await transcribeEduDictado(g.ctx, audio as Blob & { name?: string });
    return NextResponse.json(out);
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/ai/dictado");
  }
}
