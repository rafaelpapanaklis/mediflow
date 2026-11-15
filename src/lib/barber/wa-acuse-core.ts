/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — ACUSE AUTOMÁTICO opcional (núcleo PURO).

   Decisión de Rafael (15-nov-2026, #7): cuando un cliente contesta al
   recordatorio con una frase, «sí [se le contesta en automático], pero solo
   si la barbería habilita esta opción».

   Las reglas, todas juntas:
     · APAGADO por defecto. Lo enciende la barbería en /barber/whatsapp.
     · Solo si el último mensaje que le mandamos a ese cliente fue el
       RECORDATORIO (de hace 48 h como mucho) y nadie de la barbería
       contestó después: una respuesta del equipo, del bot o de cualquier
       aviso automático ya es «lo último que le dijimos» y el acuse no sale.
     · Solo si NADIE atendió ese mensaje: ni el camino del recordatorio
       (CONFIRMAR / CANCELAR / CAMBIAR), ni la baja de promociones, ni el
       bot. Y solo para lo ESCRITO: un botón, una foto o una nota de voz no
       son «una frase».
     · UNA vez por conversación y por día: no vuelve a salir si ya salió
       desde ese recordatorio o desde que empezó el día de la barbería.
     · Texto libre (la ventana de 24 h está abierta: el cliente acaba de
       escribir), editable por la barbería, y gasta del cupo como cualquier
       mensaje: sin cupo no sale.

   Sin prisma ni "server-only": se prueba sin base
   (src/lib/barber/__tests__/wa-acuse.test.ts). La capa con base es
   src/lib/barber/wa-acuse.ts y el envío vive en whatsapp.ts.
   ═══════════════════════════════════════════════════════════════════════ */

/** El texto de fábrica (decisión de Rafael). La barbería lo puede cambiar. */
export const BARBER_WA_ACK_DEFAULT_TEXT = "Recibimos tu mensaje. En un momento te contestamos.";

/** Largo máximo del texto que escribe la barbería. */
export const BARBER_WA_ACK_TEXT_MAX = 300;

/**
 * Cuánto tiempo después del recordatorio una frase del cliente todavía se
 * toma como respuesta a ESE recordatorio. Pasado esto, es una conversación
 * nueva y el acuse no sale.
 */
export const BARBER_WA_ACK_REMINDER_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Marca de la fila del acuse en barber_messages.templateName. NO empieza por
 * `sys:` (esas filas no se enseñan) porque el acuse SÍ es un mensaje que el
 * cliente leyó y la bandeja lo enseña. Lo que sí hace la marca es que el
 * acuse NO cuente como «lo último que le dijimos»: un CONFIRMAR escrito
 * después del acuse sigue confirmando la visita del recordatorio.
 */
export const BARBER_WA_ACK_MARK = "auto:acuse" as const;

export function isBarberWaAckRow(templateName: string | null | undefined): boolean {
  return templateName === BARBER_WA_ACK_MARK;
}

export interface BarberWaAckSettings {
  enabled: boolean;
  /** El texto tal como lo guardó la barbería; null = el de fábrica. */
  message: string | null;
}

export const DEFAULT_BARBER_WA_ACK_SETTINGS: BarberWaAckSettings = { enabled: false, message: null };

/** Limpia el texto: sin espacios de más, sin controles raros, con tope. */
export function cleanBarberWaAckText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.slice(0, BARBER_WA_ACK_TEXT_MAX);
}

/** De lo que venga (base o formulario) a un ajuste válido. Nunca lanza. */
export function normalizeBarberWaAckSettings(raw: unknown): BarberWaAckSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_BARBER_WA_ACK_SETTINGS };
  const src = raw as Record<string, unknown>;
  return {
    enabled: src.enabled === true,
    message: cleanBarberWaAckText(src.message),
  };
}

/** El texto que de verdad sale. */
export function barberWaAckText(settings: BarberWaAckSettings): string {
  return settings.message ?? BARBER_WA_ACK_DEFAULT_TEXT;
}

export type BarberWaAckDecision =
  | "send"
  | "off"
  | "notText"
  | "handled"
  | "botAttended"
  | "notAReminderReply"
  | "reminderTooOld"
  | "alreadyAcked"
  | "noQuota"
  | "notConnected";

export interface BarberWaAckInput {
  settings: BarberWaAckSettings;
  /** ¿Hay credenciales para mandar? */
  connected: boolean;
  /** Escrito a mano: ni botón, ni nota de voz, ni multimedia. */
  writtenText: boolean;
  /** Lo atendió el recordatorio (CONFIRMAR…) o la baja de promociones. */
  handled: boolean;
  /** El bot lo atendió (contestó, o lo contesta otro turno suyo). */
  botAttended: boolean;
  /**
   * Lo último que le dijimos a este número (sin contar marcas de sistema ni
   * acuses): plantilla y hora. null = nunca le escribimos.
   */
  lastWord: { templateName: string | null; createdAt: Date } | null;
  /** Nombre de la plantilla del recordatorio. */
  reminderTemplate: string;
  /** ¿Ya salió un acuse a este número desde el recordatorio o desde hoy? */
  alreadyAcked: boolean;
  /** ¿Cabe un mensaje más en el cupo? */
  quotaFits: boolean;
  now: Date;
}

/**
 * ¿Sale el acuse? Devuelve "send" o la razón por la que no. El orden importa
 * solo para que la razón sea la más útil; cualquier «no» es «no».
 */
export function decideBarberWaAck(input: BarberWaAckInput): BarberWaAckDecision {
  if (!input.settings.enabled) return "off";
  if (!input.writtenText) return "notText";
  if (input.handled) return "handled";
  if (input.botAttended) return "botAttended";
  const last = input.lastWord;
  // Nadie de la barbería contestó después del recordatorio: si lo hubiera
  // hecho, su respuesta sería lo último que le dijimos.
  if (!last || last.templateName !== input.reminderTemplate) return "notAReminderReply";
  if (input.now.getTime() - last.createdAt.getTime() > BARBER_WA_ACK_REMINDER_MAX_AGE_MS) {
    return "reminderTooOld";
  }
  if (input.alreadyAcked) return "alreadyAcked";
  if (!input.connected) return "notConnected";
  if (!input.quotaFits) return "noQuota";
  return "send";
}
