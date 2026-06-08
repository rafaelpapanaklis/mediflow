// Contrato del bot de WhatsApp (fundación T1). Lo consumen el motor (engine.ts),
// el wire del webhook y las terminales T2 (UI), T3 (Claude) y T4 (agenda).
// Multi-tenant: todo se resuelve por clinicId. Solo tipos — no toca Prisma en runtime.
import type { Prisma } from "@prisma/client";

/** Valor JSON serializable (alias de Prisma) para botState / businessHours. */
export type BotJson = Prisma.JsonValue;

/** Intención detectada del turno. */
export enum BotIntent {
  FAQ = "FAQ",
  BOOK_APPOINTMENT = "BOOK_APPOINTMENT",
  RESCHEDULE = "RESCHEDULE",
  CONFIRM = "CONFIRM",
  CANCEL = "CANCEL",
  HANDOFF = "HANDOFF",
  SMALLTALK = "SMALLTALK",
  UNKNOWN = "UNKNOWN",
}

/**
 * Horario de atención del bot (campo WhatsAppBotConfig.businessHours).
 * Claves "0".."6" → día de la semana (0=Lunes … 6=Domingo, igual que
 * ClinicSchedule). open/close en formato "HH:MM" (24h). Día ausente o
 * enabled=false ⇒ cerrado ese día.
 */
export type BotBusinessHours = {
  [dayOfWeek: string]: { enabled: boolean; open: string; close: string };
};

/** Configuración del bot resuelta para una clínica (espejo de WhatsAppBotConfig). */
export interface BotConfigDTO {
  id: string;
  clinicId: string;
  enabled: boolean;
  botName: string;
  persona: string | null;
  greeting: string | null;
  businessHours: BotBusinessHours | null;
  afterHoursMsg: string | null;
  canAnswerFaq: boolean;
  canBookAppointments: boolean;
  fallbackToHuman: boolean;
}

/** FAQ habilitada de la clínica (espejo de WhatsAppBotFaq). */
export interface BotFaqDTO {
  id: string;
  question: string;
  answer: string;
  enabled: boolean;
  order: number;
}

/** Referencia mínima al paciente del hilo (si está identificado). */
export interface BotPatientRef {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

/** Un turno previo de la conversación (para dar contexto a T3). */
export interface BotHistoryItem {
  role: "patient" | "bot" | "staff";
  text: string;
}

/** Entrada de un turno del bot. */
export interface BotTurnInput {
  clinicId: string;
  threadId: string;
  patient?: BotPatientRef;
  incomingText: string;
  history: BotHistoryItem[];
  botState?: BotJson | null;
}

/** Resultado de un turno del bot. */
export interface BotTurnResult {
  /** Texto a enviar al paciente. Ausente ⇒ el bot no responde. */
  reply?: string;
  intent: BotIntent;
  /** true ⇒ derivar a humano (no se responde; el mensaje queda en el Inbox). */
  handoff?: boolean;
  /**
   * Nuevo estado multi-turno a persistir en InboxThread.botState.
   * undefined ⇒ no cambiar; null ⇒ limpiar.
   */
  newBotState?: BotJson | null;
}

// ── Firmas de los stubs que rellenan T3 y T4 ───────────────────────────────
// El motor (runBotTurn) los invoca; viven en ai.ts / booking.ts para que T3 y
// T4 trabajen en archivos separados, sin tocar el motor ni pisarse entre sí.

/** T3 — respuesta libre con Claude. Devuelve un resultado o null si no responde. */
export type GenerateAiReply = (
  input: BotTurnInput,
  config: BotConfigDTO,
  faqs: BotFaqDTO[],
) => Promise<BotTurnResult | null>;

/** T4 — agendar/reagendar multi-turno. Devuelve un resultado o null si no aplica. */
export type HandleBookingTurn = (
  input: BotTurnInput,
  config: BotConfigDTO,
) => Promise<BotTurnResult | null>;
