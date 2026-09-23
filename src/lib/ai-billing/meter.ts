import "server-only";
import { chat, type ChatInput, type ChatResult } from "@/lib/integrations/claude";
import { chargeUsage, estimarCostoCents, liberarReserva, reservarSaldo, type ReservaSaldo } from "./wallet";
import { tokensPorTexto } from "./reserva-core";
import { AI_FEATURE_WHATSAPP_BOT } from "./types";

/** Los mismos valores por defecto que aplica `chat()` cuando no se le pasan. */
const MODELO_POR_DEFECTO = "claude-sonnet-4-6";
const MAX_TOKENS_POR_DEFECTO = 1024;

/** `error` del ChatResult cuando no alcanza el saldo: el llamador lo trata como cualquier fallo (handoff). */
export const ERROR_SIN_SALDO = "ai_wallet_sin_saldo";

/**
 * Envoltura facturable de chat(): RESERVA lo que la llamada puede costar,
 * ejecuta la llamada y, SOLO si fue una llamada real a Anthropic (no mock, no
 * error, con tokens), cobra el consumo al monedero de la clínica. Devuelve el
 * ChatResult intacto para no alterar al llamador.
 *
 * La reserva (H6) se calcula con el tamaño REAL de lo que se manda (a 2
 * caracteres por token, de más) y con `maxTokens` de salida, así que es un techo
 * y no un promedio. Si no alcanza, no llama: devuelve `error: ERROR_SIN_SALDO`
 * y el bot deriva a una persona, igual que cuando `canSpend` da false. Dos
 * mensajes a la vez de la misma clínica no pueden pasar los dos con saldo para uno.
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
  const model = input.model ?? MODELO_POR_DEFECTO;
  let reserva: ReservaSaldo | null;
  try {
    const caracteres = (input.system ?? "").length + JSON.stringify(input.messages ?? []).length;
    const estimado = await estimarCostoCents([
      { model, entrada: tokensPorTexto(caracteres), salida: input.maxTokens ?? MAX_TOKENS_POR_DEFECTO },
    ]);
    reserva = await reservarSaldo(clinicId, feature || AI_FEATURE_WHATSAPP_BOT, estimado);
  } catch (e) {
    // Sin poder mirar el saldo no se llama (lo mismo que hacía un canSpend que lanzaba).
    return { text: "", error: `ai_wallet_error: ${e instanceof Error ? e.message : "desconocido"}` };
  }
  if (!reserva) return { text: "", error: ERROR_SIN_SALDO };

  try {
    const result = await chat(input);

    // ¿Llamada facturable? No mock, sin error y con tokens reales.
    const billable = !result.mock && !result.error && result.inputTokens != null;
    if (billable) {
      try {
        await chargeUsage({
          clinicId,
          feature: feature || AI_FEATURE_WHATSAPP_BOT,
          model,
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
  } finally {
    // Después del cobro: soltarla antes dejaría un hueco en que no cuenta nada.
    await liberarReserva(reserva);
  }
}
