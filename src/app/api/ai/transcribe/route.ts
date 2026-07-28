import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { transcribeAudio } from "@/lib/integrations/whisper";
import { aiTokenLimitError, addAiTokens } from "@/lib/ai-tokens";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel corta el body en 4.5MB; 60s de opus a 64kbps pesan ~0.5MB.
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** Tope por grabación en el cliente (dictation-mic.tsx). Solo para acotar el cobro. */
const MAX_SECONDS = 60;

/**
 * TARIFA DEL DICTADO EN TOKENS DEL MONEDERO DE IA.
 *
 * Whisper cobra por MINUTO de audio ($0.006 USD/min en whisper-1), no por
 * tokens de Claude. Para que el dictado entre en el MISMO contador que el resto
 * de la IA (Clinic.aiTokensUsed / aiTokensLimit) se convierte usando el precio
 * de referencia que ya vive en el repo para tokens de entrada:
 * `inputUsdPerMtok = 3` USD por millón (src/lib/ai-billing/pricing.ts).
 *
 *   0.006 USD/min ÷ (3 USD / 1 000 000 tok) = 2 000 tokens por minuto de audio
 *
 * ⇒ ~33 tokens por segundo. Una grabación completa (60 s, el máximo del
 * producto) cuesta 2 000 tokens, así que un plan Profesional (200 mil/mes) da
 * para ~100 minutos de dictado. El plan Básico tiene 0 tokens ⇒ queda
 * bloqueado, coherente con el "Sin IA" de su tarifa.
 *
 * Si cambia el precio de Whisper o el de referencia, se ajusta AQUÍ y el número
 * sigue siendo explicable con la división de arriba.
 */
const AUDIO_TOKENS_PER_MINUTE = 2000;

/** Bitrate nominal con el que graba el cliente: 64 kbps = 8 KB/s. */
const AUDIO_BYTES_PER_SECOND = 8 * 1024;

/**
 * Segundos de audio a cobrar. Whisper responde en verbose_json y trae
 * `duration`; si faltara, se estima por tamaño al bitrate nominal del cliente.
 * Se acota a [1, MAX_SECONDS]: ni un clip mínimo sale gratis ni un dato raro
 * cobra de más.
 */
function billableSeconds(duration: number | undefined, bytes: number): number {
  const raw =
    typeof duration === "number" && isFinite(duration) && duration > 0
      ? duration
      : bytes / AUDIO_BYTES_PER_SECOND;
  return Math.min(MAX_SECONDS, Math.max(1, raw));
}

// MIME normalizado (sin ";codecs="). "" = algunos navegadores no reportan tipo;
// video/mp4 = etiqueta que pone iOS/Safari al audio de MediaRecorder.
const ALLOWED_MIME = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-m4a",
  "video/mp4",
  "",
]);

const LANGUAGES = new Set(["es", "en"]);

// Hint de vocabulario para Whisper: sesga la transcripción al dominio clínico.
const MEDICAL_HINT =
  "Dictado clínico dental en español (México): diagnóstico, plan de tratamiento, " +
  "odontograma, profilaxis, resina, endodoncia, corona, extracción, periodontitis, " +
  "gingivitis, oclusión, amoxicilina, ibuprofeno, radiografía periapical.";

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 40, 5 * 60 * 1000);
  if (rl) return rl;

  // Solo staff autenticado (clinicId de la sesión). El audio NO se persiste ni
  // se asocia a datos del paciente: entra, se transcribe y se descarta.
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Se esperaba multipart/form-data" }, { status: 400 });
  }

  const audio = formData.get("audio");
  if (!audio || typeof audio === "string" || audio.size === 0) {
    return NextResponse.json({ error: 'Falta el campo "audio"' }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio demasiado grande (máx 4MB)" }, { status: 413 });
  }

  const mime = (audio.type || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: "Formato de audio no soportado" }, { status: 415 });
  }

  const langRaw = formData.get("language");
  const language = typeof langRaw === "string" && LANGUAGES.has(langRaw) ? langRaw : "es";

  // Cupo de IA del plan (mismo patrón que /api/analytics/ai-insight y
  // /api/clinic-layout/optimize). FAIL-OPEN: si la lectura del cupo revienta se
  // deja pasar y se loguea — un bug de contador no puede dejar sin dictado a
  // una clínica que paga.
  let aiErr: Awaited<ReturnType<typeof aiTokenLimitError>> = null;
  try {
    aiErr = await aiTokenLimitError(ctx.clinicId);
  } catch (e) {
    console.error("[api/ai/transcribe] no se pudo leer el cupo de IA, se deja pasar:", e);
  }
  if (aiErr) return NextResponse.json(aiErr, { status: 429 });

  const isMp4 = mime === "audio/mp4" || mime === "video/mp4";
  const result = await transcribeAudio({
    audio,
    filename: audio.name || (isMp4 ? "voice.mp4" : "voice.webm"),
    mime: audio.type || "audio/webm",
    language,
    prompt: MEDICAL_HINT,
  });

  if (result.mock) {
    return NextResponse.json({ error: "Transcripción no configurada" }, { status: 503 });
  }
  if (result.error) {
    console.error("[api/ai/transcribe]", result.error);
    return NextResponse.json({ error: "No se pudo transcribir el audio" }, { status: 502 });
  }

  // Solo se cobra la transcripción que SÍ ocurrió: mock (sin API key) y error
  // de Whisper ya salieron arriba y no generan costo. FAIL-OPEN igual que el
  // check: si el incremento falla, se responde el texto y se loguea.
  const seconds = billableSeconds(result.duration, audio.size);
  const tokens = Math.max(1, Math.round((seconds * AUDIO_TOKENS_PER_MINUTE) / 60));
  try {
    await addAiTokens(ctx.clinicId, tokens, "dictation", ctx.userId);
  } catch (e) {
    console.error("[api/ai/transcribe] no se pudo cobrar el dictado:", e);
  }

  // El dictado cobraba en silencio: la respuesta no decía nada del gasto. Se
  // devuelve el cupo para que el cliente muestre el aviso discreto "gastaste ~N
  // tokens, quedan M". Relectura del contador YA incrementado (addAiTokens
  // corrió arriba), no del valor previo. FAIL-OPEN: la transcripción ya está
  // hecha y cobrada; si esta lectura revienta, los campos van en null y el
  // dictado sale igual.
  let tokensRemaining: number | null = null;
  let tokensLimit: number | null = null;
  try {
    const c = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { aiTokensUsed: true, aiTokensLimit: true },
    });
    if (c) {
      tokensLimit = c.aiTokensLimit;
      tokensRemaining = Math.max(0, c.aiTokensLimit - c.aiTokensUsed);
    }
  } catch (e) {
    console.error("[api/ai/transcribe] no se pudo leer el cupo tras cobrar:", e);
  }

  return NextResponse.json({
    text: (result.text || "").trim(),
    duration: result.duration,
    tokensCharged: tokens,
    tokensRemaining,
    tokensLimit,
  });
}
