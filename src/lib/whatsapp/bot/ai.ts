import type { GenerateAiReply } from "./types";

/**
 * IMPLEMENTA: T3 — respuesta libre del bot con Claude (Anthropic).
 *
 * El motor (runBotTurn) la llama SOLO cuando la regla de FAQ no pegó y no es un
 * turno de agenda. Recibe el turno (input), la BotConfigDTO de la clínica y sus
 * FAQs (como grounding/persona). Debe:
 *   - usar config.persona / config.botName para el tono,
 *   - responder en español neutro (tú, nunca voseo),
 *   - devolver { reply, intent } (normalmente BotIntent.SMALLTALK o FAQ), o
 *   - devolver null si prefiere derivar a humano (el motor hará el handoff).
 *
 * Modelo recomendado: claude-opus-4-8 / claude-sonnet-4-6 (ver skill claude-api).
 * NO cambies la firma (GenerateAiReply): runBotTurn la invoca tal cual.
 *
 * En la fundación (T1) devuelve null.
 */
export const generateAiReply: GenerateAiReply = async (_input, _config, _faqs) => {
  // IMPLEMENTA: T3 (Claude). Devuelve { reply, intent } o null.
  return null;
};
