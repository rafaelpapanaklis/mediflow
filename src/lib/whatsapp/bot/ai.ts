import { type ChatMessage } from "@/lib/integrations/claude";
import { chatMetered } from "@/lib/ai-billing/meter";
import { canSpend } from "@/lib/ai-billing/wallet";
import { BotIntent } from "./types";
import type {
  BotConfigDTO,
  BotFaqDTO,
  BotHistoryItem,
  BotTurnInput,
  GenerateAiReply,
} from "./types";

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
 */

// Modelo barato y rápido para chat (es además el default de chat(); lo fijamos
// explícito por claridad).
const CHAT_MODEL = "claude-sonnet-4-6";
// Salida modesta: las respuestas de WhatsApp son de 1-3 frases.
const MAX_TOKENS = 300;
// Red de seguridad ante cuelgues de red: si Claude no responde a tiempo,
// devolvemos null y el motor hace handoff en lugar de trabar el webhook.
const AI_TIMEOUT_MS = 12_000;
// Cuántos turnos previos del hilo mandamos como contexto (tokens acotados).
const MAX_HISTORY = 10;
// Centinela que el modelo debe emitir cuando NO debe responder (derivar a humano).
const HANDOFF_SENTINEL = "__HANDOFF__";

export const generateAiReply: GenerateAiReply = async (input, config, faqs) => {
  try {
    const incoming = input.incomingText?.trim();
    if (!incoming) return null; // nada que responder

    const system = buildSystemPrompt(input, config, faqs);
    const messages = buildMessages(input.history, incoming);

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

    const reply = (result.text ?? "").trim();
    if (!reply) return null;

    // El modelo pidió derivar (tema delicado / fuera de su alcance).
    if (isHandoff(reply)) return null;

    return { reply, intent: BotIntent.SMALLTALK };
  } catch {
    // Nunca propagamos: ante cualquier fallo, el motor hace el handoff.
    return null;
  }
};

/** Arma el system prompt: identidad/tono del bot + FAQs de la clínica (grounding). */
function buildSystemPrompt(
  input: BotTurnInput,
  config: BotConfigDTO,
  faqs: BotFaqDTO[],
): string {
  const botName = config.botName?.trim() || "Asistente";
  const persona = config.persona?.trim();
  const greeting = config.greeting?.trim();
  const patientFirst = input.patient?.firstName?.trim();

  const faqBlock = faqs.length
    ? faqs.map((f, i) => `${i + 1}. P: ${f.question}\n   R: ${f.answer}`).join("\n")
    : "(La clínica no cargó preguntas frecuentes.)";

  const lines: Array<string | null> = [
    `Eres ${botName}, el asistente virtual de WhatsApp de una clínica.`,
    persona
      ? `Tu tono y personalidad: ${persona}`
      : "Tu tono: cercano, amable y profesional.",
    greeting ? `Así saluda la clínica: "${greeting}"` : null,
    "",
    "REGLAS:",
    '- Escribe en español neutro y trata de "tú". NUNCA uses voseo argentino (nada de "vos", "tenés", "podés", "querés", "sos").',
    "- Sé breve y claro, como un mensaje de WhatsApp: 1 a 3 frases. Sin markdown, sin títulos, sin listas largas.",
    "- Responde con naturalidad a saludos, agradecimientos y cortesías (hola, gracias, hasta luego).",
    "- Para DATOS de la clínica usa ÚNICAMENTE la información de más abajo. NO inventes precios, horarios, servicios, ubicación ni promociones.",
    "- No des diagnósticos, indicaciones, síntomas, dosis ni consejos médicos.",
    patientFirst
      ? `- El paciente se llama ${patientFirst}; salúdalo por su nombre con naturalidad cuando encaje.`
      : null,
    `- Si te preguntan un dato de la clínica que NO está abajo, o algo médico, o piden hablar con una persona/humano: NO improvises y responde EXACTAMENTE con ${HANDOFF_SENTINEL} (solo eso, sin más texto).`,
    "",
    "INFORMACIÓN DE LA CLÍNICA (preguntas frecuentes — tu única fuente):",
    faqBlock,
  ];

  return lines.filter((l): l is string => l !== null).join("\n");
}

/**
 * Convierte el historial del hilo + el mensaje actual en messages[] válidos
 * para Claude: paciente⇒user, bot/staff⇒assistant; arranca en user; fusiona
 * turnos consecutivos del mismo rol (alternancia estricta y segura).
 */
function buildMessages(history: BotHistoryItem[], incoming: string): ChatMessage[] {
  const raw: ChatMessage[] = [];
  for (const h of history.slice(-MAX_HISTORY)) {
    const content = h.text?.trim();
    if (!content) continue;
    raw.push({ role: h.role === "patient" ? "user" : "assistant", content });
  }
  raw.push({ role: "user", content: incoming });

  // El primer mensaje debe ser del usuario (descarta assistant iniciales).
  while (raw.length > 0 && raw[0].role === "assistant") raw.shift();

  // Fusiona mensajes consecutivos del mismo rol → alternancia user/assistant.
  const merged: ChatMessage[] = [];
  for (const m of raw) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.content}`;
    else merged.push({ ...m });
  }
  return merged;
}

/** ¿La respuesta del modelo es la señal de derivar a humano? */
function isHandoff(reply: string): boolean {
  return (
    reply.toUpperCase().includes(HANDOFF_SENTINEL) || /^\s*handoff\s*$/i.test(reply)
  );
}

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
