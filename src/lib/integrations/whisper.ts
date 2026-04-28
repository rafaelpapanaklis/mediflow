import "server-only";

/**
 * Wrapper Whisper para transcripción audio → texto. Usado por:
 * - Voice input del AI assistant.
 * - Audio-to-SOAP en /clinical (graba consulta → transcribe → IA arma SOAP).
 *
 * Stub: si no hay OPENAI_API_KEY devuelve { text: "", mock: true }.
 * Producción: usa la API de OpenAI Whisper (audio/transcriptions).
 */

export interface TranscribeInput {
  /** Audio buffer en formato soportado por Whisper (mp3, wav, webm, m4a, etc). */
  audio: Buffer | Blob;
  filename: string;
  mime: string;
  /** ISO code: "es", "en", etc. Whisper auto-detecta si no se especifica. */
  language?: string;
}

export interface TranscribeResult {
  text: string;
  duration?: number;
  language?: string;
  mock?: boolean;
  error?: string;
}

export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { text: "", mock: true, error: "openai_not_configured" };
  }

  try {
    const form = new FormData();
    const blob = input.audio instanceof Blob
      ? input.audio
      : new Blob([new Uint8Array(input.audio)], { type: input.mime });
    form.append("file", blob, input.filename);
    form.append("model", "whisper-1");
    if (input.language) form.append("language", input.language);
    form.append("response_format", "verbose_json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { text: "", error: `whisper_${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json();
    return {
      text: data.text ?? "",
      duration: data.duration,
      language: data.language,
    };
  } catch (err) {
    return { text: "", error: err instanceof Error ? err.message : "transcribe_failed" };
  }
}
