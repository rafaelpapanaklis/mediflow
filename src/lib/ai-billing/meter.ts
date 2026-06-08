import "server-only";
import { chat, type ChatInput, type ChatResult } from "@/lib/integrations/claude";
import { chargeUsage } from "./wallet";
import { AI_FEATURE_WHATSAPP_BOT } from "./types";

/**
 * Envoltura facturable de chat(): ejecuta la llamada y, SOLO si fue una llamada
 * real a Anthropic (no mock, no error, con tokens), cobra el consumo al monedero
 * de la clínica. Devuelve el ChatResult intacto para no alterar al llamador.
 *
 * El cobro nunca rompe la respuesta del bot: si falla el metering, se traga el
 * error y se devuelve igual el texto de Claude. NO cobra llamadas mock (sin
 * ANTHROPIC_API_KEY) ni con error.
 */
export async function chatMetered(
  clinicId: string,
  feature: string,
  input: ChatInput,
  threadId?: string,
): Promise<ChatResult> {
  const result = await chat(input);

  // ¿Llamada facturable? No mock, sin error y con tokens reales.
  const billable = !result.mock && !result.error && result.inputTokens != null;
  if (billable) {
    try {
      await chargeUsage({
        clinicId,
        feature: feature || AI_FEATURE_WHATSAPP_BOT,
        model: input.model ?? "claude-sonnet-4-6",
        inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
        cacheTokens: (result.cacheCreation ?? 0) + (result.cacheRead ?? 0),
        threadId,
      });
    } catch {
      // Metering best-effort: jamás bloquea la respuesta del bot.
    }
  }

  return result;
}
