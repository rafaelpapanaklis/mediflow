// ═══════════════════════════════════════════════════════════════════════════
// Notas de voz al bot de WhatsApp (ws1-t5) — el cableado real.
//
// El flujo y sus reglas viven en `nota-de-voz-core.ts` (puro, con pruebas).
// Aquí solo se inyectan las dependencias de verdad, como `saldo.ts` con
// `saldo-core.ts`: Meta (media id → URL → binario, con el token de la
// clínica), el transcriptor del dictado, el cupo de IA y su interruptor, y la
// bandeja.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { getWhatsAppMediaMeta } from "@/lib/whatsapp";
import { decryptField } from "@/lib/crypto/envelope";
import { tokensDeAudio } from "@/lib/integrations/whisper-tarifa";
import { addAiTokens, aiTokenLimitError } from "@/lib/ai-tokens";
import { funcionIaApagada } from "@/lib/ai-billing/interruptores.server";
import { persistentRateLimitKey } from "@/lib/failban";
import {
  PISTA_WHISPER,
  VENTANA_VOZ_SEG,
  VOZ_POR_REMITENTE,
  procesarNotaDeVoz,
  type DepsNotaDeVoz,
  type EntradaNotaDeVoz,
  type ResultadoNotaDeVoz,
} from "./nota-de-voz-core";

export type { ResultadoNotaDeVoz } from "./nota-de-voz-core";
export { MSG_NO_PUDE, MSG_DEMASIADO_LARGO } from "./nota-de-voz-core";

/** Descargar de Meta y transcribir no pueden comerse el webhook entero. */
const DESCARGA_TIMEOUT_MS = 15_000;
const WHISPER_TIMEOUT_MS = 25_000;

const depsReales: DepsNotaDeVoz = {
  async botEncendido(clinicId) {
    const cfg = await prisma.whatsAppBotConfig.findUnique({ where: { clinicId }, select: { enabled: true } });
    return cfg?.enabled === true;
  },
  // «Dictado por voz» en Saldo IA → Funciones de IA: es la misma función (el
  // mismo transcriptor y el mismo cupo). Falla abierto, como en el dictado.
  dictadoApagado: (clinicId) => funcionIaApagada(clinicId, "dictation"),
  async sinCupo(clinicId) {
    // FAIL-OPEN igual que /api/ai/transcribe: un bug de contador no deja sin
    // transcripción a una clínica que paga.
    try {
      return (await aiTokenLimitError(clinicId)) !== null;
    } catch (err) {
      console.error("[wa-voz] no se pudo leer el cupo de IA, se deja pasar:", err);
      return false;
    }
  },
  permitirRemitente: (clave) => persistentRateLimitKey(clave, VOZ_POR_REMITENTE, VENTANA_VOZ_SEG),
  transcriptorConfigurado: () => !!process.env.OPENAI_API_KEY,
  metaDelAudio: (accessToken, mediaId) => getWhatsAppMediaMeta(accessToken, mediaId),
  async descargar(accessToken, url, maxBytes) {
    const token = decryptField(accessToken) ?? accessToken;
    const res = await fetch(url, {
      // User-Agent explícito: sin él el CDN de Meta a veces devuelve HTML en
      // vez del archivo (mismo detalle que el proxy api/whatsapp/media).
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "curl/8.4.0" },
      signal: AbortSignal.timeout(DESCARGA_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`descarga_${res.status}`);
    const largo = Number(res.headers.get("content-length")) || 0;
    if (largo > maxBytes) throw new Error("demasiado_grande");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("demasiado_grande");
    return buf;
  },
  async transcribir({ audio, filename, mime }) {
    // import() perezoso: whisper.ts es `server-only` y este módulo lo importa
    // el webhook, que se prueba con tsx (ahí ese paquete no existe).
    const { transcribeAudio } = await import("@/lib/integrations/whisper");
    // Sin `language`: Whisper detecta el idioma (hay pacientes que escriben en
    // inglés); la pista en español lo sesga a lo normal.
    return transcribeAudio({
      audio,
      filename,
      mime,
      prompt: PISTA_WHISPER,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
    });
  },
  // Mismo punto de cobro y misma tarifa que el dictado. Sin usuario: lo pidió
  // el paciente, no alguien del equipo.
  cobrar: (clinicId, segundos) => addAiTokens(clinicId, tokensDeAudio(segundos), "dictation", null),
  async reescribirEntrada(clinicId, inMsgId, body) {
    // Acotado a la clínica aunque el id ya sea único: así se escribe todo.
    await prisma.inboxMessage.updateMany({ where: { id: inMsgId, thread: { clinicId } }, data: { body } });
  },
  log(evento, datos) {
    // Nunca el texto ni el audio: solo qué pasó.
    console.info(`[wa-voz] ${evento}`, datos);
  },
};

/**
 * Lo único que llama el webhook. Nunca lanza. Ver el contrato en
 * nota-de-voz-core.ts.
 */
export function entenderNotaDeVoz(entrada: EntradaNotaDeVoz): Promise<ResultadoNotaDeVoz> {
  return procesarNotaDeVoz(entrada, depsReales);
}
