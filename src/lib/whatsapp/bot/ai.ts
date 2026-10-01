import { chatMetered } from "@/lib/ai-billing/meter";
import { canSpend } from "@/lib/ai-billing/wallet";
import { funcionIaApagada } from "@/lib/ai-billing/interruptores.server";
import { BotIntent } from "./types";
import type { GenerateAiReply } from "./types";
import { buildMessages, buildSystemPrompt, clasificarRespuesta } from "./ai-prompt";

/**
 * T3 — Respuesta libre del bot de WhatsApp con Claude (Anthropic).
 *
 * El motor (runBotTurn) la invoca como fallback cuando la FAQ por reglas no
 * pegó y no es un turno de agenda. Reusa el wrapper central `chat()` de
 * src/lib/integrations/claude.ts (fetch a la API de Anthropic con x-api-key,
 * sin SDK; NO lanza: devuelve { text, error, mock }).
 *
 * Diseño:
 * - System prompt = nombre del bot + persona (tono) + cómo se presenta la
 *   clínica, con las FAQs como ÚNICA fuente (grounding): no inventa precios ni
 *   info médica. Español neutro con "tú", NUNCA voseo. Respuestas cortas.
 * - El historial del hilo (input.history) va como contexto; se personaliza con
 *   el nombre del paciente (input.patient.firstName) si existe.
 * - Tema delicado (consejo médico / dato que no tiene / piden humano) ⇒ el
 *   modelo emite un centinela y aquí devolvemos null para que el motor derive a
 *   un humano (handoff). Errores/timeout también ⇒ null (no truena el webhook).
 *
 * NO cambia la firma GenerateAiReply: runBotTurn la invoca tal cual.
 *
 * ws1-t5 — el prompt vive en ./ai-prompt (puro, con pruebas): reglas antes que
 * la persona de la clínica, fecha y hora reales en cada turno, y el centinela
 * de agenda. Cuando el modelo lo emite devolvemos { intent: BOOK_APPOINTMENT }
 * SIN reply: el motor lo toma como «pasa al flujo de agenda real».
 */

// Modelo barato y rápido para chat (es además el default de chat(); lo fijamos
// explícito por claridad).
const CHAT_MODEL = "claude-sonnet-4-6";
// Salida modesta: las respuestas de WhatsApp son de 1-3 frases.
const MAX_TOKENS = 300;
// Red de seguridad ante cuelgues de red: si Claude no responde a tiempo,
// devolvemos null y el motor hace handoff en lugar de trabar el webhook.
const AI_TIMEOUT_MS = 12_000;

export const generateAiReply: GenerateAiReply = async (input, config, faqs) => {
  try {
    const incoming = input.incomingText?.trim();
    if (!incoming) return null; // nada que responder

    // La fecha se calcula aquí, en cada turno: nunca un texto fijo.
    const system = buildSystemPrompt(input, config, faqs, new Date());
    const messages = buildMessages(input.history, incoming);

    // La clínica apagó la respuesta libre en Saldo de IA (ws1-t1): no llamamos
    // a Claude. Igual que sin saldo: el motor deriva a una persona y la FAQ por
    // reglas y la agenda siguen, que no gastan IA.
    if (await funcionIaApagada(input.clinicId, "whatsapp_bot")) return null;

    // Cobro de IA: si la clínica no tiene saldo (ni auto-recarga con tarjeta), no
    // llamamos a Claude — el motor cae a handoff y la FAQ por reglas sigue gratis.
    if (!(await canSpend(input.clinicId))) return null;

    const result = await withTimeout(
      chatMetered(
        input.clinicId,
        "whatsapp_bot",
        { system, messages, model: CHAT_MODEL, maxTokens: MAX_TOKENS },
        input.threadId,
      ),
      AI_TIMEOUT_MS,
    );

    // Timeout, error de red/API, o stub sin ANTHROPIC_API_KEY ⇒ derivar a humano.
    if (!result || result.error || result.mock) return null;

    const clase = clasificarRespuesta(result.text ?? "");
    // El modelo pidió derivar (tema delicado / fuera de su alcance) o no dijo nada.
    if (clase.tipo === "handoff") return null;
    // Quiere cita: sin reply, el motor lo pasa a la agenda real (engine.ts).
    if (clase.tipo === "agenda") return { intent: BotIntent.BOOK_APPOINTMENT };

    return { reply: clase.texto, intent: BotIntent.SMALLTALK };
  } catch {
    // Nunca propagamos: ante cualquier fallo, el motor hace el handoff.
    return null;
  }
};

/** Resuelve a null si la promesa no termina dentro de `ms` (o si rechaza). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}
