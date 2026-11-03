import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { transcribeAudio } from "@/lib/integrations/whisper";
import { tokensDeAudio } from "@/lib/integrations/whisper-tarifa";
import { addAiTokens, liquidarCupoIa, reservarCupoIa, soltarCupoIa, type ErrorCupoIa, type ReservaCupoIa } from "@/lib/ai-tokens";
import { cortarSiIaApagada } from "@/lib/ai-billing/interruptores.server";
import { denyIfMissingAnyPermission } from "@/lib/auth/require-permission";
import { PERMISOS_DE_DICTADO } from "@/lib/integrations/dictado-permisos";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel corta el body en 4.5MB; 60s de opus a 64kbps pesan ~0.5MB.
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/**
 * Tope por grabación en el cliente (dictation-mic.tsx). Ya NO acota el cobro
 * (seguridad ola 2b, lead 19: quien llamaba a la API directo mandaba una hora
 * y pagaba un minuto); es lo MÍNIMO que se reserva del cupo antes de Whisper.
 */
const MAX_SECONDS = 60;

// Tarifa (2 000 tokens del cupo por minuto de audio): la misma para el dictado
// y para las notas de voz del bot de WhatsApp, explicada en whisper-tarifa.ts.

/** Bitrate nominal con el que graba el cliente: 64 kbps = 8 KB/s. */
const AUDIO_BYTES_PER_SECOND = 8 * 1024;

/**
 * Segundos de audio a cobrar: los que Whisper dice que transcribió (y cobra a
 * DaleControl). Responde en verbose_json y trae `duration`; si faltara, se
 * estima por tamaño al bitrate nominal del cliente. Mínimo 1 s (ningún clip
 * sale gratis) y SIN tope arriba: el cupo mide minutos reales de Whisper.
 */
function billableSeconds(duration: number | undefined, bytes: number): number {
  const raw =
    typeof duration === "number" && isFinite(duration) && duration > 0
      ? duration
      : bytes / AUDIO_BYTES_PER_SECOND;
  return Math.max(1, raw);
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

  // Solo quien ve el micrófono en la interfaz (escribe en el expediente, el
  // consentimiento, la placa, el plan o Ortodoncia). Un rol de solo lectura que
  // llame a la API directo no gasta el cupo de IA de la clínica. ANTES del
  // interruptor y del cupo: no se lee nada de la clínica para quien no puede.
  const sinPermiso = denyIfMissingAnyPermission(
    { role: ctx.role, permissionsOverride: ctx.permissionsOverride },
    [...PERMISOS_DE_DICTADO],
  );
  if (sinPermiso) return sinPermiso;

  // Interruptor de la clínica (Saldo de IA → Funciones de IA): ANTES de gastar.
  const apagada = await cortarSiIaApagada(ctx.clinicId, "dictation");
  if (apagada) return apagada;

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

  // Cupo de IA del plan: se RESERVA antes de llamar a Whisper (seguridad ola
  // 2b, lead 18: varias a la vez ya no pasan todas con el cupo leído antes de
  // cobrar). Lo que se aparta: lo que dura el archivo al bitrate nominal del
  // cliente, y nunca menos que una grabación entera (MAX_SECONDS). Un archivo
  // grande aparta lo suyo aunque el atacante lo comprima más. FAIL-OPEN: si la reserva
  // revienta se deja pasar y se loguea — un bug de contador no puede dejar sin
  // dictado a una clínica que paga; entonces se cobra como antes, al final.
  let reserva: ReservaCupoIa | null = null;
  let aiErr: ErrorCupoIa | null = null;
  try {
    const segundosAReservar = Math.max(MAX_SECONDS, audio.size / AUDIO_BYTES_PER_SECOND);
    ({ reserva, error: aiErr } = await reservarCupoIa(ctx.clinicId, tokensDeAudio(segundosAReservar)));
  } catch (e) {
    console.error("[api/ai/transcribe] no se pudo reservar el cupo de IA, se deja pasar:", e);
  }
  if (aiErr) return NextResponse.json(aiErr, { status: 429 });

  const isMp4 = mime === "audio/mp4" || mime === "video/mp4";
  let result: Awaited<ReturnType<typeof transcribeAudio>>;
  try {
    result = await transcribeAudio({
      audio,
      filename: audio.name || (isMp4 ? "voice.mp4" : "voice.webm"),
      mime: audio.type || "audio/webm",
      language,
      prompt: MEDICAL_HINT,
    });
  } catch (e) {
    await soltarCupoIa(reserva);
    throw e;
  }

  if (result.mock) {
    await soltarCupoIa(reserva);
    return NextResponse.json({ error: "Transcripción no configurada" }, { status: 503 });
  }
  if (result.error) {
    await soltarCupoIa(reserva);
    console.error("[api/ai/transcribe]", result.error);
    return NextResponse.json({ error: "No se pudo transcribir el audio" }, { status: 502 });
  }

  // Solo se cobra la transcripción que SÍ ocurrió: mock (sin API key) y error
  // de Whisper ya salieron arriba y no generan costo. FAIL-OPEN igual que el
  // check: si el incremento falla, se responde el texto y se loguea.
  const seconds = billableSeconds(result.duration, audio.size);
  const tokens = tokensDeAudio(seconds);
  try {
    if (reserva) await liquidarCupoIa(reserva, tokens, "dictation", ctx.userId);
    else await addAiTokens(ctx.clinicId, tokens, "dictation", ctx.userId);
  } catch (e) {
    console.error("[api/ai/transcribe] no se pudo cobrar el dictado:", e);
  }

  // El dictado cobraba en silencio: la respuesta no decía nada del gasto. Se
  // devuelve el cupo para que el cliente muestre el aviso discreto "gastaste ~N
  // tokens, quedan M". Relectura del contador YA liquidado (corrió arriba),
  // no del valor previo. FAIL-OPEN: la transcripción ya está
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
