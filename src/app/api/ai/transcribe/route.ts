import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { transcribeAudio } from "@/lib/integrations/whisper";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel corta el body en 4.5MB; 60s de opus a 64kbps pesan ~0.5MB.
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

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

  return NextResponse.json({ text: (result.text || "").trim(), duration: result.duration });
}
