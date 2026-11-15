/**
 * Qué se le dice al dueño cuando no hay chats atendidos por una persona.
 * «El bot está atendiendo todos los chats» SOLO es cierto si el bot está
 * encendido y puede contestar; apagado o sin WhatsApp, no.
 */
export type BotEmptyKey = "pauses.empty" | "pauses.emptyOff" | "pauses.emptyNotConnected" | "pauses.emptyBlocked";

export function botEmptyKey(args: {
  /** ¿Hay WhatsApp conectado? */
  connected: boolean;
  /** ¿Está encendido el interruptor del bot? */
  enabled: boolean;
  /** ¿Algo del entorno le impide contestar (sin WhatsApp, sin IA, sin almacenamiento)? */
  blocked: boolean;
}): BotEmptyKey {
  if (!args.connected) return "pauses.emptyNotConnected";
  if (!args.enabled) return "pauses.emptyOff";
  if (args.blocked) return "pauses.emptyBlocked";
  return "pauses.empty";
}
