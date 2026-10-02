// Contrato del bot de WhatsApp (fundación T1). Lo consumen el motor (engine.ts),
// el wire del webhook y las terminales T2 (UI), T3 (Claude) y T4 (agenda).
// Multi-tenant: todo se resuelve por clinicId. Solo tipos — no toca Prisma en runtime.
import type { Prisma } from "@prisma/client";
import type { MensajeInteractivo } from "../interactivo";

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
  /**
   * ws1-t3 — el bot puede decir la próxima mensualidad y lo pendiente, sin
   * adivinar nunca de qué paciente se trata (ver bot/saldo-core.ts). Apagado
   * de fábrica.
   *
   * A diferencia de los otros dos, NO es una columna de `whatsapp_bot_configs`:
   * vive en `Clinic.reminderSettings.cobranza.bot`, el mismo Json donde ya
   * viven `recall` y `eventos`, para no tocar el schema. `loadBotConfig` lo
   * resuelve y lo deja aquí, así que el motor y el núcleo no notan la
   * diferencia.
   *
   * OPCIONAL a propósito: un DTO al que nadie le puso el campo está APAGADO,
   * que es exactamente el default que queremos. Así ningún otro constructor
   * del DTO tiene que enterarse de que este interruptor existe para seguir
   * comportándose como hoy.
   */
  canAnswerBalance?: boolean;
  /**
   * ws1-t1 ronda 2 — interruptor SEPARADO del de dinero: el bot puede decir
   * la fecha del próximo "Control de ortodoncia" del paciente (nunca dinero,
   * ver bot/saldo-core.ts). Vive en `OrthodonticsClinicSettings.
   * proximoControlBotEnabled` (no en `whatsapp_bot_configs`, mismo motivo que
   * `canAnswerBalance`). OPCIONAL, pero a diferencia de `canAnswerBalance` su
   * ausencia SÍ debe leerse como "encendido" — es el default de fábrica
   * (`normalizarProximoControlBotEnabled`, clinic-settings-db.ts) — así que
   * ningún caller lo deja `undefined` sin querer decir "apagado": `loadBotConfig`
   * SIEMPRE lo resuelve a un boolean explícito.
   */
  canAnswerOrthoControl?: boolean;
  /**
   * ws1-t3 (2-oct-2026) — «Dar precios de Procedimientos» y «Dar precios de
   * Ortodoncia». Columnas de `whatsapp_bot_configs` que NO están en
   * schema.prisma (sql/ws1-t3-bot-precios.sql; ver bot/precios-bot.ts): el
   * motor no las lee de aquí, las lee ai.ts al armar el prompt. Aquí solo
   * viajan a la pantalla. OPCIONALES: ausente = apagado.
   */
  canQuoteProcedurePrices?: boolean;
  canQuoteOrthoPrices?: boolean;
  /** Solo para la pantalla: false = falta pegar el SQL (interruptores deshabilitados). */
  preciosDisponibles?: boolean;
  /** Solo para la pantalla: ¿la clínica tiene el módulo de Ortodoncia? */
  tieneOrtodoncia?: boolean;
  fallbackToHuman: boolean;
  /** TZ de la clínica: el saldo necesita saber qué día es HOY donde atienden. */
  timezone?: string;
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
  /**
   * ws1-t3 — el paciente TOCÓ un botón o una fila de lista (no escribió). `id`
   * es el que puso el motor al ofrecer las opciones (`bk.<paso>.<opción>`);
   * `incomingText` trae el título, para todo lo que lee texto. Ausente = texto
   * escrito (o nota de voz transcrita, ws1-t5).
   */
  eleccion?: { id: string; titulo: string };
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
  /**
   * ws1-t3 — botones o lista para acompañar a `reply` (que sigue siendo el
   * texto completo: cuerpo del mensaje, bandeja y respaldo). El webhook decide
   * si se puede mandar interactivo; si no, sale `reply` como texto.
   */
  interactivo?: MensajeInteractivo;
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
