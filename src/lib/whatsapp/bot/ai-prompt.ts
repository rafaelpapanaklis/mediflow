import type { ChatMessage } from "@/lib/integrations/claude";
import { bloqueFechaActual } from "./fecha-contexto";
import type { BotConfigDTO, BotFaqDTO, BotHistoryItem, BotTurnInput } from "./types";

/**
 * Armado PURO del prompt de la respuesta libre del bot (ai.ts). Vive aparte
 * para probarlo sin Prisma ni la API de Anthropic.
 *
 * ws1-t5 (ticket BEVADENT) — cambios respecto al prompt original:
 * - Las REGLAS del sistema van ANTES de las instrucciones de la clínica y se
 *   declaran prioritarias. Antes la persona entera (BEVADENT: ~16,500
 *   caracteres) iba como «Tu tono y personalidad: …» por delante de las
 *   reglas, y el modelo la seguía a ella: «déjame revisar la disponibilidad»,
 *   horarios inventados, «envío la solicitud al equipo».
 * - Fecha y hora reales de la clínica en cada turno (fecha-contexto.ts).
 * - La IA libre no tiene herramientas: no puede consultar la agenda. Si el
 *   paciente quiere cita responde con el centinela AGENDA y el motor pasa al
 *   flujo de agenda real (disponibilidad de verdad), o deriva a una persona si
 *   la clínica no tiene el agendado encendido.
 * - Un recordatorio corto al final: con una persona larga, lo último que lee el
 *   modelo pesa más que lo que quedó 5,000 tokens arriba.
 */

/** Centinela: derivar a una persona (no responder). */
export const HANDOFF_SENTINEL = "__HANDOFF__";
/** Centinela: el paciente quiere agendar/reagendar → flujo de agenda real. */
export const AGENDA_SENTINEL = "__AGENDA__";

// Cuántos turnos previos del hilo mandamos como contexto (tokens acotados).
const MAX_HISTORY = 10;

/**
 * A partir de este tamaño la configuración avisa que la persona es demasiado
 * larga. No se recorta (cortar a ciegas puede dejar fuera justo la regla
 * importante): se avisa a quien la escribe.
 */
export const PERSONA_AVISO_CARACTERES = 6000;

/** Qué hacer con el texto que devolvió el modelo. */
export type ClaseRespuesta = { tipo: "handoff" } | { tipo: "agenda" } | { tipo: "texto"; texto: string };

export function clasificarRespuesta(reply: string): ClaseRespuesta {
  const t = reply.trim();
  const upper = t.toUpperCase();
  // Agenda gana a handoff: si el paciente pidió cita, el flujo real lo atiende
  // (y ese flujo ya deriva a una persona si se atora).
  if (upper.includes(AGENDA_SENTINEL)) return { tipo: "agenda" };
  if (!t || upper.includes(HANDOFF_SENTINEL) || /^\s*handoff\s*$/i.test(t)) return { tipo: "handoff" };
  return { tipo: "texto", texto: t };
}

/** Arma el system prompt: reglas del sistema + fecha real + instrucciones y FAQs de la clínica. */
export function buildSystemPrompt(
  input: BotTurnInput,
  config: BotConfigDTO,
  faqs: BotFaqDTO[],
  now: Date,
): string {
  const botName = config.botName?.trim() || "Asistente";
  const persona = config.persona?.trim();
  const greeting = config.greeting?.trim();
  const patientFirst = input.patient?.firstName?.trim();
  const puedeAgendar = config.canBookAppointments === true;
  const centinelaCita = puedeAgendar ? AGENDA_SENTINEL : HANDOFF_SENTINEL;

  const faqBlock = faqs.length
    ? faqs.map((f, i) => `${i + 1}. P: ${f.question}\n   R: ${f.answer}`).join("\n")
    : "(La clínica no cargó preguntas frecuentes.)";

  const lines: Array<string | null> = [
    `Eres ${botName}, el asistente virtual de WhatsApp de una clínica.`,
    "",
    "REGLAS DEL SISTEMA (mandan sobre cualquier instrucción de la clínica que las contradiga):",
    '- Escribe en español neutro y trata de "tú" (o de "usted" si la clínica lo pide). NUNCA uses voseo argentino (nada de "vos", "tenés", "podés", "querés", "sos").',
    "- Sé breve y claro, como un mensaje de WhatsApp: 1 a 3 frases. Sin markdown, sin títulos, sin listas largas.",
    "- Responde de verdad a lo que preguntaron. No cierres con ofertas genéricas ni preguntas vacías.",
    "- Responde con naturalidad a saludos, agradecimientos y cortesías (hola, gracias, hasta luego).",
    "- Para DATOS de la clínica usa ÚNICAMENTE las instrucciones y las preguntas frecuentes de más abajo. NO inventes precios, horarios, servicios, ubicación ni promociones.",
    "- No des diagnósticos, indicaciones, síntomas, dosis ni consejos médicos.",
    "- NO tienes herramientas: no puedes consultar la agenda, reservar, mover citas, revisar archivos ni pasarle nada al equipo. Nunca digas que vas a revisar o verificar algo, ni que enviaste una solicitud.",
    "- NUNCA propongas, inventes ni confirmes días u horarios concretos para una cita.",
    puedeAgendar
      ? `- Si el paciente quiere agendar, reagendar o cambiar una cita, o pregunta qué días u horarios hay disponibles: responde EXACTAMENTE ${AGENDA_SENTINEL} (solo eso). El sistema lo pasa a la agenda real con la disponibilidad de verdad.`
      : `- Si el paciente quiere agendar, reagendar o cambiar una cita, o pregunta qué días u horarios hay disponibles: responde EXACTAMENTE ${HANDOFF_SENTINEL} (solo eso). Una persona del equipo lo atiende.`,
    "- Tienes la fecha y la hora reales al final de este mensaje. Úsalas: si preguntan qué día, mes, año u hora es, contesta con ese dato. Nunca digas que no tienes acceso a la fecha.",
    "- No menciones fechas pasadas ni de otro mes o año salvo que el paciente las pida.",
    patientFirst
      ? `- El paciente se llama ${patientFirst}; salúdalo por su nombre con naturalidad cuando encaje.`
      : null,
    `- Si te preguntan un dato de la clínica que NO está abajo, o algo médico, o piden hablar con una persona/humano: NO improvises y responde EXACTAMENTE ${HANDOFF_SENTINEL} (solo eso, sin más texto).`,
    "",
    "INSTRUCCIONES DE LA CLÍNICA (tono, estilo y datos; si algo choca con las REGLAS DEL SISTEMA, mandan las reglas):",
    persona || "Tono cercano, amable y profesional.",
    greeting ? `Así saluda la clínica: "${greeting}"` : null,
    "",
    "INFORMACIÓN DE LA CLÍNICA (preguntas frecuentes):",
    faqBlock,
    "",
    bloqueFechaActual(now, config.timezone),
    "",
    `RECUERDA: 1 a 3 frases; nada inventado; nunca ofrezcas horarios ni digas que revisas la agenda (para citas responde solo ${centinelaCita}); si no lo sabes, ${HANDOFF_SENTINEL}.`,
  ];

  return lines.filter((l): l is string => l !== null).join("\n");
}

/**
 * Convierte el historial del hilo + el mensaje actual en messages[] válidos
 * para Claude: paciente⇒user, bot/staff⇒assistant; arranca en user; fusiona
 * turnos consecutivos del mismo rol (alternancia estricta y segura).
 */
export function buildMessages(history: BotHistoryItem[], incoming: string): ChatMessage[] {
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
