import { NextResponse } from "next/server";
import { rateLimitKey } from "@/lib/rate-limit";
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
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 🔴 EL PERMISO ES "expediente.write", no uno nuevo. Dictar es escribir la
 * nota: el micrófono es una forma de teclear. Un permiso propio sería un
 * interruptor que no cierra ninguna puerta —quien lo tenga apagado escribe
 * exactamente la misma nota a mano— y en este vertical el catálogo no
 * admite interruptores que no cierren nada.
 *
 * ⚠️ OLA 8 — Y AHORA ADEMÁS SE COBRA. El dictado consume el CUPO MENSUAL
 * de IA del instituto (src/lib/edu/ia-cupo.ts). Si no hay cupo configurado
 * contesta 503 explicando que el contrato no lo incluye; si se acabó,
 * contesta 402 diciendo cuánto se lleva consumido y a quién pedirle más.
 * Ni 500 ni un micrófono muerto sin explicación.
 *
 * 🔴 EL AUDIO NO SE GUARDA. Entra, se transcribe y se descarta: no toca
 * Storage y no queda en ninguna fila. Un archivo con la voz de un paciente
 * contando su motivo de consulta es un dato sensible que nadie pidió
 * conservar. Lo único que queda es el RENGLÓN DEL GASTO: quién dictó,
 * cuántos segundos y cuánto costó — sin una palabra de lo que se dijo.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("expediente.write");
  if ("response" in g) return g.response;

  // ── 🔴 P2-12 · EL FRENO POR SESIÓN, ANTES DE LEER EL AUDIO ───────────
  // El cupo mensual (Ola 8) protege el presupuesto del INSTITUTO; sin este
  // freno, una sola sesión en bucle podía comerse el cupo de toda la
  // escuela en una tarde — y el cupo agotado apaga el micrófono de TODOS.
  // Por eduUserId y no por IP: la clínica entera sale por la misma IP, y un
  // tope por IP frenaría al piso clínico completo por culpa de uno.
  //
  // 10 por minuto es generoso a propósito: nadie dicta más de diez tramos
  // en sesenta segundos con un paciente enfrente. Es el rateLimit en
  // memoria del repo — por instancia serverless, suficiente como freno de
  // bucle; el candado del dinero sigue siendo el cupo.
  if (!rateLimitKey(`edu-ia-dictado:${g.ctx.eduUserId}`, 10)) {
    return NextResponse.json(
      { error: "Demasiados dictados seguidos. Espera un momento y vuelve a intentar." },
      { status: 429 },
    );
  }

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

  // 🔴 El caso es solo ATRIBUCIÓN del gasto, y llega del cliente — así que
  // el servidor lo vuelve a buscar DENTRO del alcance antes de guardarlo
  // (ver `casoParaElDictado` en src/lib/edu/ia.ts). Un id de fuera se
  // guarda como null: el detalle de "en qué se fue el cupo" solo sirve si
  // es verdad. Y que no venga no impide dictar: en el tamizaje todavía no
  // hay caso, y ése es justo el momento en que más se dicta.
  const caso = formData.get("caso");

  try {
    const out = await transcribeEduDictado(
      g.ctx,
      audio as Blob & { name?: string },
      g.ctx.institution.timezone,
      typeof caso === "string" ? caso : null,
    );
    return NextResponse.json(out);
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/ai/dictado");
  }
}
